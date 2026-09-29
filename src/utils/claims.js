const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', '..', 'data', 'claims.json')
function load() {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{}')
  }
  try { return JSON.parse(fs.readFileSync(file)) } catch (e) { return {} }
}
function save(data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)) }
const COOLDOWN = 4 * 3600
function getRemaining(userId) {
  const data = load()
  const now = Math.floor(Date.now() / 1000)
  if (!data[userId]) return 0
  const last = data[userId]
  const diff = last + COOLDOWN - now
  return diff > 0 ? diff : 0
}
function canClaim(userId) { return getRemaining(userId) === 0 }
function setClaim(userId) {
  const data = load()
  data[userId] = Math.floor(Date.now() / 1000)
  save(data)
}
module.exports = { getRemaining, canClaim, setClaim }
