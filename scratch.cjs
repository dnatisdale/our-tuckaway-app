const fs = require('fs');
let code = fs.readFileSync('src/FinanceApp.jsx', 'utf8');

const actionsRowRegex = /          <div\r?\n            className="header-actions-row"[\s\S]*?<\/button>\r?\n          <\/div>/;

const match = code.match(actionsRowRegex);
if (!match) {
  console.log("Could not find header-actions-row");
  process.exit(1);
}

const buttonsCode = match[0];

// Remove the buttons from the bottom
code = code.replace(actionsRowRegex, '');

// Insert it above the Title section
const insertTarget = `        >\r\n          <div style={{ textAlign: "center" }}>`;
const insertTargetAlt = `        >\n          <div style={{ textAlign: "center" }}>`;

let usedTarget = code.includes(insertTarget) ? insertTarget : code.includes(insertTargetAlt) ? insertTargetAlt : null;

if (!usedTarget) {
  console.log("Could not find insert target");
  process.exit(1);
}

const newInsertTarget = `        >
${buttonsCode}

          <div style={{ textAlign: "center" }}>`;

code = code.replace(usedTarget, newInsertTarget);

fs.writeFileSync('src/FinanceApp.jsx', code);
console.log("Reordered successfully");
