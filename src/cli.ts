import { Command } from 'commander';
import { updateUserForce, getUserByUserId, getAllPremiumUsers, upsertUserIfNotExists } from './database/database';
import { pool } from './database/database';

const program = new Command();
program
  .command('set-premium <userId>')
  .description('Set a user as premium')
  .action(async (userId) => {
    try {
      let user = await getUserByUserId(Number(userId));
      console.log('Initial user query result:', user);
      
      if (!user) {
        // Create a new user if not found using upsert
        const newUser = {
          user_id: Number(userId),
          username: '',
          default_language_code: '',
          language_code: null,
          openai_api_key: null,
          usage_type: 'premium'
        };
        console.log('Creating new user with:', newUser);
        const result = await upsertUserIfNotExists(newUser);
        console.log('Upsert result:', result);
        console.log(`New user ${userId} created and set as PREMIUM.`);
      } else {
        // Update existing user
        console.log('Updating existing user from:', user);
        user.usage_type = 'premium';
        console.log('Updating to:', user);
        const result = await updateUserForce(user);
        console.log('Update result:', result);
        console.log(`User ${userId} is now set as PREMIUM.`);
      }
      
      // Wait a moment for the database update to take effect
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify the user is set as premium
      const verifyUser = await getUserByUserId(Number(userId));
      console.log('Verification query result:', verifyUser);
      
      if (verifyUser && verifyUser.usage_type === 'premium') {
        console.log(`Successfully verified that user ${userId} is now PREMIUM.`);
      } else if (verifyUser) {
        console.error(`Warning: User ${userId} exists but usage_type is '${verifyUser.usage_type}' instead of 'premium'.`);
      } else {
        console.error(`Warning: User ${userId} not found during verification.`);
      }
    } catch (error) {
      console.error('Error setting user as PREMIUM:', error);
    } finally {
      pool.end(); // Close the database connection
    }
  });

program
  .command('remove-premium <userId>')
  .description('Remove premium status from a user')
  .action(async (userId) => {
    try {
      const user = await getUserByUserId(Number(userId));
      if (user) {
        user.usage_type = null;
        await updateUserForce(user);
        console.log(`User ${userId} is no longer PREMIUM.`);
        
        // Verify the premium status was removed
        const verifyUser = await getUserByUserId(Number(userId));
        if (verifyUser && verifyUser.usage_type === null) {
          console.log(`Successfully verified that user ${userId} is no longer PREMIUM.`);
        } else {
          console.error(`Warning: Failed to verify removal of premium status for user ${userId}.`);
        }
      } else {
        console.log(`User with ID ${userId} not found.`);
      }
    } catch (error) {
      console.error('Error removing PREMIUM status from user:', error);
    } finally {
      pool.end(); // Close the database connection
    }
  });

program
  .command('list-premium')
  .description('List all premium users')
  .action(async () => {
    try {
      const premiumUsers = await getAllPremiumUsers();

      // Sort users: first by created_at descending, then nulls last
      premiumUsers.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        if (a.created_at) return -1;
        if (b.created_at) return 1;
        return 0;
      });

      if (premiumUsers.length > 0) {
        console.log('Premium Users:');
        premiumUsers.forEach(user => {
          const createdAt = user.created_at 
            ? `Created at: ${new Date(user.created_at).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`
            : 'Creation date not available';
          console.log(`ID: ${user.user_id}, Username: ${user.username}, ${createdAt}`);
        });
      } else {
        console.log('No PREMIUM users found.');
      }
    } catch (error) {
      console.error('Error fetching PREMIUM users:', error);
    } finally {
      pool.end(); // Close the database connection
    }
  });

program.parse(process.argv);
