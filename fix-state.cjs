const fs = require('fs');
const path = 'D:/Placement project/backend/server.js';
let text = fs.readFileSync(path, 'utf8');
const oldText = "const state = loadJson(USERS_FILE, createDefaultState());";
const newText = `const state = {
  users: loadJson(USERS_FILE, []),
  resumes: loadJson(RESUMES_FILE, []),
  atsResults: loadJson(ATS_FILE, []),
  dsaProblems: loadJson(DSA_FILE, []),
  interviews: loadJson(INTERVIEWS_FILE, []),
  notifications: loadJson(NOTIFICATIONS_FILE, []),
};`;
if (!text.includes(oldText)) {
  throw new Error('Old state initialization not found');
}
text = text.replace(oldText, newText);
fs.writeFileSync(path, text);
