import { Command } from 'commander';
import { updateUserForce, getUserByUserId, getAllPremiumUsers } from './database/database';
import { pool } from './database/database';

const program = new Command();

program
  .command('set-premium <userId>')
  .description('Set a user as premium')
  .action(async (userId) => {
    try {
      const user = await getUserByUserId(Number(userId));
      if (user) {
        user.usage_type = 'premium';
        await updateUserForce(user);
        console.log(`User ${userId} is now set as PREMIUM.`);
      } else {
        console.log(`User with ID ${userId} not found.`);
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
