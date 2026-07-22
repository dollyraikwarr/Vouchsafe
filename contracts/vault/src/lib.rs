#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, token};

#[contracttype]
pub enum DataKey {
    EngagementContract,
    Admin,
}

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    pub fn initialize(env: Env, engagement_contract: Address, admin: Address) {
        if env.storage().instance().has(&DataKey::EngagementContract) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::EngagementContract, &engagement_contract);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().extend_ttl(100, 518400);
    }

    pub fn deposit(env: Env, from: Address, token: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "deposit amount must be positive");

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        env.events().publish(
            (symbol_short!("deposit"), from.clone()),
            (token, amount),
        );
    }

    pub fn release(env: Env, to: Address, token: Address, amount: i128) {
        let engagement_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::EngagementContract)
            .expect("vault not initialized");

        // REQUIRE AUTH FROM THE ENGAGEMENT CONTRACT (C2C Security Guard)
        engagement_contract.require_auth();
        assert!(amount > 0, "release amount must be positive");

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        env.events().publish(
            (symbol_short!("vault_rel"), to.clone()),
            (token, amount),
        );
    }

    pub fn refund(env: Env, to: Address, token: Address, amount: i128) {
        let engagement_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::EngagementContract)
            .expect("vault not initialized");

        // REQUIRE AUTH FROM THE ENGAGEMENT CONTRACT (C2C Security Guard)
        engagement_contract.require_auth();
        assert!(amount > 0, "refund amount must be positive");

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        env.events().publish(
            (symbol_short!("vault_ref"), to.clone()),
            (token, amount),
        );
    }

    pub fn get_engagement_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::EngagementContract)
    }

    pub fn get_balance(env: Env, token: Address) -> i128 {
        let token_client = token::Client::new(&env, &token);
        token_client.balance(&env.current_contract_address())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_vault_initialize_and_auth() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let engagement_contract = Address::generate(&env);

        let vault_id = env.register_contract(None, VaultContract);
        let vault_client = VaultContractClient::new(&env, &vault_id);

        vault_client.initialize(&engagement_contract, &admin);
        assert_eq!(vault_client.get_engagement_contract(), Some(engagement_contract));
    }
}
