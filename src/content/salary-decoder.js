// BOSS 直聘薪资解密 — 私有区字符映射到数字
function decodeSalary(text) {
  const map = { '': '1', '': '2', '': '3', '': '4', '': '5', '': '6', '': '7', '': '8', '': '9', '': '0' };
  return (text || '').replace(/[-]/g, ch => map[ch] || ch);
}
