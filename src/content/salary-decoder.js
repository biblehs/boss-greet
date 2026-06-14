// BOSS Zhipin salary decryption — private-use area character mapping to digits
function decodeSalary(text) {
  const map = { '': '1', '': '2', '': '3', '': '4', '': '5', '': '6', '': '7', '': '8', '': '9', '': '0' };
  return (text || '').replace(/[-]/g, ch => map[ch] || ch);
}
