#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

mod vault_interface {
    use soroban_sdk::{symbol_short, Address, Env, IntoVal};

    pub fn call_deposit(env: &Env, vault: &Address, from: &Address, token: &Address, amount: i128) {
        env.invoke_contract::<()>(
            vault,
            &symbol_short!("deposit"),
            soroban_sdk::vec![env, from.to_val(), token.to_val(), amount.into_val(env),],
        );
    }

    pub fn call_release(env: &Env, vault: &Address, to: &Address, token: &Address, amount: i128) {
        env.invoke_contract::<()>(
            vault,
            &symbol_short!("release"),
            soroban_sdk::vec![env, to.to_val(), token.to_val(), amount.into_val(env),],
        );
    }

    pub fn call_refund(env: &Env, vault: &Address, to: &Address, token: &Address, amount: i128) {
        env.invoke_contract::<()>(
            vault,
            &symbol_short!("refund"),
            soroban_sdk::vec![env, to.to_val(), token.to_val(), amount.into_val(env),],
        );
    }
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Created = 0,
    Funded = 1,
    WorkSubmitted = 2,
    Approved = 3,
    Completed = 4,
    Cancelled = 5,
    Expired = 6,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Engagement {
    pub id: u64,
    pub client: Address,
    pub developer: Address,
    pub token: Address,
    pub amount: i128,
    pub deadline: u64,
    pub status: Status,
    pub work_url: String,
    pub work_pr_url: String,
    pub work_commit: String,
    pub work_note: String,
}

#[contracttype]
pub enum DataKey {
    NextId,
    Engagement(u64),
    Admin,
    VaultContract,
}

#[contract]
pub struct VouchsafeContract;

#[contractimpl]
impl VouchsafeContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().extend_ttl(100, 518400);
    }

    pub fn set_vault(env: Env, admin: Address, vault: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized with admin");
        assert!(stored_admin == admin, "caller must be admin");

        env.storage()
            .instance()
            .set(&DataKey::VaultContract, &vault);
        env.storage().instance().extend_ttl(100, 518400);

        env.events()
            .publish((symbol_short!("vault_set"), admin), vault);
    }

    pub fn get_vault(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::VaultContract)
    }

    pub fn create_engagement(
        env: Env,
        client: Address,
        developer: Address,
        token: Address,
        amount: i128,
        deadline: u64,
    ) -> u64 {
        client.require_auth();
        assert!(amount > 0, "amount must be positive");

        let mut id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        id += 1;
        env.storage().instance().set(&DataKey::NextId, &id);
        env.storage().instance().extend_ttl(100, 518400);

        let engagement = Engagement {
            id,
            client: client.clone(),
            developer: developer.clone(),
            token: token.clone(),
            amount,
            deadline,
            status: Status::Created,
            work_url: String::from_str(&env, ""),
            work_pr_url: String::from_str(&env, ""),
            work_commit: String::from_str(&env, ""),
            work_note: String::from_str(&env, ""),
        };

        let key = DataKey::Engagement(id);
        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        env.events()
            .publish((symbol_short!("created"), id), (client, developer, amount));

        id
    }

    pub fn get_engagement(env: Env, id: u64) -> Option<Engagement> {
        let key = DataKey::Engagement(id);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, 100, 518400);
            Some(env.storage().persistent().get(&key).unwrap())
        } else {
            None
        }
    }

    pub fn fund_engagement(env: Env, id: u64, client: Address) {
        client.require_auth();

        let key = DataKey::Engagement(id);
        let mut engagement: Engagement = env
            .storage()
            .persistent()
            .get(&key)
            .expect("engagement not found");

        assert!(
            engagement.status == Status::Created,
            "invalid state: not in CREATED status"
        );
        assert!(engagement.client == client, "caller must be the client");

        // INTER-CONTRACT CALL: Deposit into Vault Contract if configured, else direct transfer to engagement contract
        if let Some(vault_address) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::VaultContract)
        {
            vault_interface::call_deposit(
                &env,
                &vault_address,
                &client,
                &engagement.token,
                engagement.amount,
            );
        } else {
            let token_client = token::Client::new(&env, &engagement.token);
            token_client.transfer(&client, &env.current_contract_address(), &engagement.amount);
        }

        engagement.status = Status::Funded;
        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        env.events().publish((symbol_short!("funded"), id), client);
    }

    pub fn submit_work(
        env: Env,
        id: u64,
        developer: Address,
        work_url: String,
        work_pr_url: String,
        work_commit: String,
        work_note: String,
    ) {
        developer.require_auth();

        let key = DataKey::Engagement(id);
        let mut engagement: Engagement = env
            .storage()
            .persistent()
            .get(&key)
            .expect("engagement not found");

        assert!(
            engagement.status == Status::Funded,
            "invalid state: not in FUNDED status"
        );
        assert!(
            engagement.developer == developer,
            "caller must be the developer"
        );

        engagement.work_url = work_url;
        engagement.work_pr_url = work_pr_url;
        engagement.work_commit = work_commit;
        engagement.work_note = work_note;
        engagement.status = Status::WorkSubmitted;

        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        env.events()
            .publish((symbol_short!("submitted"), id), developer);
    }

    pub fn approve_work(env: Env, id: u64, client: Address) {
        client.require_auth();

        let key = DataKey::Engagement(id);
        let mut engagement: Engagement = env
            .storage()
            .persistent()
            .get(&key)
            .expect("engagement not found");

        assert!(
            engagement.status == Status::WorkSubmitted,
            "invalid state: not in WORK_SUBMITTED status"
        );
        assert!(engagement.client == client, "caller must be the client");

        engagement.status = Status::Approved;
        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        env.events()
            .publish((symbol_short!("approved"), id), client);

        // INTER-CONTRACT CALL: Release payment from Vault Contract if configured, else direct transfer
        if let Some(vault_address) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::VaultContract)
        {
            vault_interface::call_release(
                &env,
                &vault_address,
                &engagement.developer,
                &engagement.token,
                engagement.amount,
            );
        } else {
            let token_client = token::Client::new(&env, &engagement.token);
            token_client.transfer(
                &env.current_contract_address(),
                &engagement.developer,
                &engagement.amount,
            );
        }

        env.events().publish(
            (symbol_short!("released"), id),
            (engagement.developer.clone(), engagement.amount),
        );

        engagement.status = Status::Completed;
        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        env.events().publish((symbol_short!("completed"), id), ());
    }

    pub fn cancel_engagement(env: Env, id: u64, client: Address) {
        client.require_auth();

        let key = DataKey::Engagement(id);
        let mut engagement: Engagement = env
            .storage()
            .persistent()
            .get(&key)
            .expect("engagement not found");

        assert!(
            engagement.status == Status::Created,
            "can only cancel CREATED un-funded engagements"
        );
        assert!(engagement.client == client, "caller must be the client");

        engagement.status = Status::Cancelled;
        env.storage().persistent().set(&key, &engagement);

        env.events()
            .publish((symbol_short!("cancelled"), id), client);
    }

    pub fn claim_expired_refund(env: Env, id: u64, client: Address) {
        client.require_auth();

        let key = DataKey::Engagement(id);
        let mut engagement: Engagement = env
            .storage()
            .persistent()
            .get(&key)
            .expect("engagement not found");

        assert!(
            engagement.status == Status::Funded,
            "invalid state: not in FUNDED status"
        );
        assert!(engagement.client == client, "caller must be the client");

        let current_time = env.ledger().timestamp();
        assert!(
            engagement.deadline > 0 && current_time > engagement.deadline,
            "deadline has not passed yet"
        );

        // INTER-CONTRACT CALL: Refund payment from Vault Contract to client
        if let Some(vault_address) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::VaultContract)
        {
            vault_interface::call_refund(
                &env,
                &vault_address,
                &engagement.client,
                &engagement.token,
                engagement.amount,
            );
        } else {
            let token_client = token::Client::new(&env, &engagement.token);
            token_client.transfer(
                &env.current_contract_address(),
                &engagement.client,
                &engagement.amount,
            );
        }

        engagement.status = Status::Expired;
        env.storage().persistent().set(&key, &engagement);

        env.events()
            .publish((symbol_short!("expired"), id), (client, engagement.amount));
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Env};

    fn setup_test() -> (
        Env,
        Address,
        Address,
        Address,
        Address,
        VouchsafeContractClient<'static>,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let developer = Address::generate(&env);
        let token_admin = Address::generate(&env);

        let token_address = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();

        let contract_id = env.register_contract(None, VouchsafeContract);
        let vouchsafe_client = VouchsafeContractClient::new(&env, &contract_id);

        (
            env,
            client,
            developer,
            token_admin,
            token_address,
            vouchsafe_client,
        )
    }

    #[test]
    fn test_happy_path() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id =
            vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &1000);

        vouchsafe_client.fund_engagement(&id, &client);
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&client),
            500
        );

        vouchsafe_client.submit_work(
            &id,
            &developer,
            &String::from_str(&env, "https://github.com/user/repo"),
            &String::from_str(&env, "https://github.com/user/repo/pull/1"),
            &String::from_str(&env, "abc1234"),
            &String::from_str(&env, "Completed deliverable"),
        );

        vouchsafe_client.approve_work(&id, &client);
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&developer),
            500
        );

        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Completed);
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_funding() {
        let (_env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let id =
            vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &1000);

        vouchsafe_client.fund_engagement(&id, &developer);
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_work_submission() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id =
            vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &1000);
        vouchsafe_client.fund_engagement(&id, &client);

        vouchsafe_client.submit_work(
            &id,
            &client,
            &String::from_str(&env, "https://github.com"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        );
    }

    #[test]
    #[should_panic]
    fn test_unauthorized_approval() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id =
            vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &1000);
        vouchsafe_client.fund_engagement(&id, &client);
        vouchsafe_client.submit_work(
            &id,
            &developer,
            &String::from_str(&env, "https://github.com"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        );

        vouchsafe_client.approve_work(&id, &developer);
    }

    #[test]
    fn test_cancel_engagement() {
        let (_env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let id =
            vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &1000);

        vouchsafe_client.cancel_engagement(&id, &client);
        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Cancelled);
    }

    #[test]
    fn test_claim_expired_refund() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let deadline = 1000;
        let id = vouchsafe_client.create_engagement(
            &client,
            &developer,
            &token_address,
            &500,
            &deadline,
        );
        vouchsafe_client.fund_engagement(&id, &client);

        env.ledger().set_timestamp(1001);

        vouchsafe_client.claim_expired_refund(&id, &client);
        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Expired);
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&client),
            1000
        );
    }

    #[test]
    fn test_set_vault_authorized() {
        let (env, _client, _developer, _admin, _token_address, vouchsafe_client) = setup_test();
        let admin = Address::generate(&env);
        let vault = Address::generate(&env);

        vouchsafe_client.initialize(&admin);
        vouchsafe_client.set_vault(&admin, &vault);
        assert_eq!(vouchsafe_client.get_vault(), Some(vault));
    }

    #[test]
    #[should_panic]
    fn test_set_vault_unauthorized() {
        let (env, _client, _developer, _admin, _token_address, vouchsafe_client) = setup_test();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let vault = Address::generate(&env);

        vouchsafe_client.initialize(&admin);
        vouchsafe_client.set_vault(&attacker, &vault);
    }

    #[contract]
    pub struct MockVaultContract;

    #[contractimpl]
    impl MockVaultContract {
        pub fn initialize(env: Env, engagement_contract: Address, admin: Address) {
            admin.require_auth();
            env.storage()
                .instance()
                .set(&symbol_short!("eng_ctr"), &engagement_contract);
        }
        pub fn deposit(env: Env, from: Address, token: Address, amount: i128) {
            from.require_auth();
            token::Client::new(&env, &token).transfer(
                &from,
                &env.current_contract_address(),
                &amount,
            );
        }
        pub fn release(env: Env, to: Address, token: Address, amount: i128) {
            let eng: Address = env
                .storage()
                .instance()
                .get(&symbol_short!("eng_ctr"))
                .unwrap();
            eng.require_auth();
            token::Client::new(&env, &token).transfer(
                &env.current_contract_address(),
                &to,
                &amount,
            );
        }
        pub fn refund(env: Env, to: Address, token: Address, amount: i128) {
            let eng: Address = env
                .storage()
                .instance()
                .get(&symbol_short!("eng_ctr"))
                .unwrap();
            eng.require_auth();
            token::Client::new(&env, &token).transfer(
                &env.current_contract_address(),
                &to,
                &amount,
            );
        }
    }

    #[test]
    fn test_vault_c2c_flow() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let admin = Address::generate(&env);

        // Register Mock Vault contract
        let vault_id = env.register_contract(None, MockVaultContract);
        let vault_client = MockVaultContractClient::new(&env, &vault_id);

        // Initialize Vouchsafe and Vault
        vouchsafe_client.initialize(&admin);
        vouchsafe_client.set_vault(&admin, &vault_id);
        vault_client.initialize(&vouchsafe_client.address, &admin);

        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id =
            vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &1000);

        // Fund engagement -> deposits into Vault
        vouchsafe_client.fund_engagement(&id, &client);
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&vault_id),
            500
        );

        vouchsafe_client.submit_work(
            &id,
            &developer,
            &String::from_str(&env, "https://github.com/user/repo"),
            &String::from_str(&env, "https://github.com/user/repo/pull/1"),
            &String::from_str(&env, "abc1234"),
            &String::from_str(&env, "Completed deliverable"),
        );

        // Approve work -> releases from Vault to developer
        vouchsafe_client.approve_work(&id, &client);
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&developer),
            500
        );
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&vault_id),
            0
        );

        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Completed);
    }

    #[test]
    fn test_vault_expired_refund_flow() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let admin = Address::generate(&env);

        let vault_id = env.register_contract(None, MockVaultContract);
        let vault_client = MockVaultContractClient::new(&env, &vault_id);

        vouchsafe_client.initialize(&admin);
        vouchsafe_client.set_vault(&admin, &vault_id);
        vault_client.initialize(&vouchsafe_client.address, &admin);

        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let deadline = 1000;
        let id = vouchsafe_client.create_engagement(
            &client,
            &developer,
            &token_address,
            &500,
            &deadline,
        );
        vouchsafe_client.fund_engagement(&id, &client);
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&vault_id),
            500
        );

        env.ledger().set_timestamp(1001);

        vouchsafe_client.claim_expired_refund(&id, &client);
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&client),
            1000
        );
        assert_eq!(
            token::Client::new(&env, &token_address).balance(&vault_id),
            0
        );

        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Expired);
    }

    #[test]
    #[should_panic]
    fn test_double_release_prevention() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id =
            vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &1000);
        vouchsafe_client.fund_engagement(&id, &client);
        vouchsafe_client.submit_work(
            &id,
            &developer,
            &String::from_str(&env, "https://github.com"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        );

        vouchsafe_client.approve_work(&id, &client);
        // Second approval should panic
        vouchsafe_client.approve_work(&id, &client);
    }

    #[test]
    #[should_panic]
    fn test_double_refund_prevention() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let deadline = 1000;
        let id = vouchsafe_client.create_engagement(
            &client,
            &developer,
            &token_address,
            &500,
            &deadline,
        );
        vouchsafe_client.fund_engagement(&id, &client);

        env.ledger().set_timestamp(1001);
        vouchsafe_client.claim_expired_refund(&id, &client);
        // Second refund claim should panic
        vouchsafe_client.claim_expired_refund(&id, &client);
    }
}
