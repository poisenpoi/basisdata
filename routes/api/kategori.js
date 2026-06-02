const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT k.id_kategori, k.nama_kategori, k.deskripsi,
        COUNT(p.id_produk) AS total
      FROM kategori k
      LEFT JOIN produk p ON p.id_kategori = k.id_kategori
      GROUP BY k.id_kategori, k.nama_kategori, k.deskripsi
      ORDER BY k.id_kategori
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [[row]] = await db.query(`
      SELECT id_kategori, id_parent_kategori, nama_kategori, deskripsi
      FROM kategori
      WHERE id_kategori = ?
    `, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { nama_kategori, deskripsi, id_parent_kategori } = req.body || {};
    if (!nama_kategori) {
      return res.status(400).json({ error: 'Nama kategori wajib diisi.' });
    }
    const [result] = await db.query(`
      INSERT INTO kategori (id_parent_kategori, nama_kategori, deskripsi)
      VALUES (?, ?, ?)
    `, [id_parent_kategori || null, nama_kategori, deskripsi || null]);
    res.status(201).json({ id_kategori: result.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { nama_kategori, deskripsi, id_parent_kategori } = req.body || {};
    if (!nama_kategori) {
      return res.status(400).json({ error: 'Nama kategori wajib diisi.' });
    }
    const [result] = await db.query(`
      UPDATE kategori
      SET id_parent_kategori = ?, nama_kategori = ?, deskripsi = ?
      WHERE id_kategori = ?
    `, [id_parent_kategori || null, nama_kategori, deskripsi || null, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM kategori WHERE id_kategori = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Tidak bisa menghapus kategori yang masih dipakai produk.' });
  }
});

module.exports = router;
