const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', '..', 'data', 'points.json')
function load() {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{}')
  }
  try { return JSON.parse(fs.readFileSync(file)) } catch (e) { return {} }
}
function save(data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)) }
function getBalance(userId) {
  const data = load()
  if (!(userId in data)) { data[userId] = 1000; save(data) }
  return data[userId]
}
function setBalance(userId, amount) {
  const data = load()
  data[userId] = Math.max(0, Math.floor(amount))
  save(data)
  return data[userId]
}
function add(userId, delta) {
  const bal = getBalance(userId)
  return setBalance(userId, bal + delta)
}
module.exports = { getBalance, setBalance, add }
