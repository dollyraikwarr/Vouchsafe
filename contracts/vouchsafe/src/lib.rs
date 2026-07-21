#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, token};

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Created = 0,
    Funded = 1,
    WorkSubmitted = 2,
    Approved = 3,
    Completed = 4,
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
}

#[contract]
pub struct VouchsafeContract;

#[contractimpl]
impl VouchsafeContract {
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

        // Emit Event: EngagementCreated
        env.events().publish(
            (symbol_short!("created"), id),
            (client, developer, amount),
        );

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

        // Transfer payment token from client to contract escrow
        let token_client = token::Client::new(&env, &engagement.token);
        token_client.transfer(&client, &env.current_contract_address(), &engagement.amount);

        engagement.status = Status::Funded;
        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        // Emit Event: EngagementFunded
        env.events().publish(
            (symbol_short!("funded"), id),
            client,
        );
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
        assert!(engagement.developer == developer, "caller must be the developer");

        engagement.work_url = work_url;
        engagement.work_pr_url = work_pr_url;
        engagement.work_commit = work_commit;
        engagement.work_note = work_note;
        engagement.status = Status::WorkSubmitted;

        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        // Emit Event: WorkSubmitted
        env.events().publish(
            (symbol_short!("submitted"), id),
            developer,
        );
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

        // Move to Approved state
        engagement.status = Status::Approved;
        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        // Emit Event: WorkApproved
        env.events().publish(
            (symbol_short!("approved"), id),
            client,
        );

        // Release payment from escrow to developer
        let token_client = token::Client::new(&env, &engagement.token);
        token_client.transfer(
            &env.current_contract_address(),
            &engagement.developer,
            &engagement.amount,
        );

        // Emit Event: PaymentReleased
        env.events().publish(
            (symbol_short!("released"), id),
            (engagement.developer.clone(), engagement.amount),
        );

        // Update status to Completed
        engagement.status = Status::Completed;
        env.storage().persistent().set(&key, &engagement);
        env.storage().persistent().extend_ttl(&key, 100, 518400);

        // Emit Event: EngagementCompleted
        env.events().publish(
            (symbol_short!("completed"), id),
            (),
        );
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

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

        (env, client, developer, token_admin, token_address, vouchsafe_client)
    }

    #[test]
    fn test_happy_path() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        // Admin mints tokens for the client
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        assert_eq!(token_client.balance(&client), 1000);

        // 1. Client creates engagement
        let amount = 500i128;
        let deadline = 1735689600u64;
        let id = vouchsafe_client.create_engagement(&client, &developer, &token_address, &amount, &deadline);
        assert_eq!(id, 1);

        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Created);
        assert_eq!(engagement.amount, amount);
        assert_eq!(engagement.client, client);
        assert_eq!(engagement.developer, developer);

        // 2. Client funds engagement
        vouchsafe_client.fund_engagement(&id, &client);
        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Funded);
        assert_eq!(token_client.balance(&client), 500);
        assert_eq!(token_client.balance(&vouchsafe_client.address), 500);

        // 3. Developer submits work
        let work_url = String::from_str(&env, "https://github.com/vouchsafe/pr/1");
        let work_pr_url = String::from_str(&env, "https://github.com/vouchsafe/pull/1");
        let work_commit = String::from_str(&env, "a1b2c3d4");
        let work_note = String::from_str(&env, "Implementation of core components completed.");

        vouchsafe_client.submit_work(
            &id,
            &developer,
            &work_url,
            &work_pr_url,
            &work_commit,
            &work_note,
        );
        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::WorkSubmitted);
        assert_eq!(engagement.work_commit, work_commit);

        // 4. Client approves work
        vouchsafe_client.approve_work(&id, &client);
        let engagement = vouchsafe_client.get_engagement(&id).unwrap();
        assert_eq!(engagement.status, Status::Completed);

        // Payment should be released
        assert_eq!(token_client.balance(&client), 500);
        assert_eq!(token_client.balance(&developer), 500);
        assert_eq!(token_client.balance(&vouchsafe_client.address), 0);
    }

    #[test]
    #[should_panic(expected = "caller must be the client")]
    fn test_unauthorized_funding() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id = vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &100u64);

        // Attacker (developer in this case) tries to fund the engagement
        vouchsafe_client.fund_engagement(&id, &developer);
    }

    #[test]
    #[should_panic(expected = "caller must be the developer")]
    fn test_unauthorized_work_submission() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id = vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &100u64);
        vouchsafe_client.fund_engagement(&id, &client);

        let work_url = String::from_str(&env, "https://github.com/vouchsafe/pr/1");
        let work_pr_url = String::from_str(&env, "https://github.com/vouchsafe/pull/1");
        let work_commit = String::from_str(&env, "a1b2c3d4");
        let work_note = String::from_str(&env, "Implementation of core components completed.");

        // Client (unauthorized user for work submission) tries to submit work
        vouchsafe_client.submit_work(
            &id,
            &client,
            &work_url,
            &work_pr_url,
            &work_commit,
            &work_note,
        );
    }

    #[test]
    #[should_panic(expected = "caller must be the client")]
    fn test_unauthorized_approval() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id = vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &100u64);
        vouchsafe_client.fund_engagement(&id, &client);

        let work_url = String::from_str(&env, "https://github.com/vouchsafe/pr/1");
        let work_pr_url = String::from_str(&env, "https://github.com/vouchsafe/pull/1");
        let work_commit = String::from_str(&env, "a1b2c3d4");
        let work_note = String::from_str(&env, "Implementation of core components completed.");

        vouchsafe_client.submit_work(
            &id,
            &developer,
            &work_url,
            &work_pr_url,
            &work_commit,
            &work_note,
        );

        // Developer tries to self-approve
        vouchsafe_client.approve_work(&id, &developer);
    }

    #[test]
    #[should_panic(expected = "invalid state: not in FUNDED status")]
    fn test_submit_work_invalid_state() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        let id = vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &100u64);

        let work_url = String::from_str(&env, "https://github.com/vouchsafe/pr/1");
        let work_pr_url = String::from_str(&env, "https://github.com/vouchsafe/pull/1");
        let work_commit = String::from_str(&env, "a1b2c3d4");
        let work_note = String::from_str(&env, "Implementation of core components completed.");

        // Submitting work when engagement is only in CREATED state (not yet FUNDED)
        vouchsafe_client.submit_work(
            &id,
            &developer,
            &work_url,
            &work_pr_url,
            &work_commit,
            &work_note,
        );
    }

    #[test]
    #[should_panic(expected = "invalid state: not in WORK_SUBMITTED status")]
    fn test_approve_work_invalid_state() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        let id = vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &100u64);

        // Approving when state is CREATED
        vouchsafe_client.approve_work(&id, &client);
    }

    #[test]
    #[should_panic(expected = "invalid state: not in WORK_SUBMITTED status")]
    fn test_double_payment_release_prevention() {
        let (env, client, developer, _token_admin, token_address, vouchsafe_client) = setup_test();

        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&client, &1000);

        let id = vouchsafe_client.create_engagement(&client, &developer, &token_address, &500, &100u64);
        vouchsafe_client.fund_engagement(&id, &client);

        let work_url = String::from_str(&env, "https://github.com/vouchsafe/pr/1");
        let work_pr_url = String::from_str(&env, "https://github.com/vouchsafe/pull/1");
        let work_commit = String::from_str(&env, "a1b2c3d4");
        let work_note = String::from_str(&env, "Implementation of core components completed.");

        vouchsafe_client.submit_work(
            &id,
            &developer,
            &work_url,
            &work_pr_url,
            &work_commit,
            &work_note,
        );

        // First approval succeeds and moves state to Completed
        vouchsafe_client.approve_work(&id, &client);

        // Second approval should panic as state is Completed (not WORK_SUBMITTED)
        vouchsafe_client.approve_work(&id, &client);
    }
}
