const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id_kurir, kode_kurir, nama_kurir, is_active FROM master_kurir ORDER BY id_kurir'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { kode_kurir, nama_kurir, is_active } = req.body || {};
    if (!kode_kurir || !nama_kurir) {
      return res.status(400).json({ error: 'Kode dan nama kurir wajib diisi.' });
    }
    const [result] = await db.query(`
      INSERT INTO master_kurir (nama_kurir, kode_kurir, is_active)
      VALUES (?, ?, ?)
    `, [nama_kurir, kode_kurir, is_active ? 1 : 0]);
    res.status(201).json({ id_kurir: result.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { kode_kurir, nama_kurir, is_active } = req.body || {};
    if (!kode_kurir || !nama_kurir) {
      return res.status(400).json({ error: 'Kode dan nama kurir wajib diisi.' });
    }
    const [result] = await db.query(`
      UPDATE master_kurir
      SET nama_kurir = ?, kode_kurir = ?, is_active = ?
      WHERE id_kurir = ?
    `, [nama_kurir, kode_kurir, is_active ? 1 : 0, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Kurir tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM master_kurir WHERE id_kurir = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Kurir tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Tidak bisa menghapus kurir yang masih dipakai pengiriman.' });
  }
});

module.exports = router;
