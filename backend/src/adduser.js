// usage: node src/adduser.js <email> "<full name>" <company id> <password>
import { all } from './db.js';
import { addUser } from './auth.js';

const [email, name, company, password] = process.argv.slice(2);
if (!password) {
  console.log('usage: node src/adduser.js <email> "<full name>" <company id> <password>');
  console.log('companies:', all('SELECT id, name FROM companies').map((c) => `${c.id}=${c.name}`).join(', '));
  process.exit(1);
}
try { addUser(email, name, company, password); console.log('created', email); } catch (e) { console.error(e.message); process.exit(1); }
