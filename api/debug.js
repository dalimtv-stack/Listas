// api/debug.js
'use strict';
const { kvDelete } = require('./kv');
module.exports = async (req, res) => {
  const key = req.query.key;
  if (key) {
    await kvDelete(key);
    return res.json({ status: `Clave ${key} borrada` });
  }
  res.json({ status: 'Usa ?key=clave para borrar' });
};
