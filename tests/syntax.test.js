// 모든 js/*.js · gas/*.gs · sw.js 가 문법 오류 없이 읽히는지
const fs = require('fs'), vm = require('vm'), path = require('path');
const files = [...fs.readdirSync('js').map(f => path.join('js', f)), ...fs.readdirSync('gas').filter(f => f.endsWith('.gs')).map(f => path.join('gas', f)), 'sw.js'];
let bad = 0;
files.forEach(f => {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); }
  catch (e) { bad++; console.error('❌', f, e.message); }
});
if (bad) process.exit(1);
console.log('✅ 문법 확인', files.length + '개 파일');
