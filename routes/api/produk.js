const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { q, kategori, stok, aktif, sort } = req.query;

    let where = '1=1';
    const params = [];
    if (q) {
      where += ' AND (p.nama_produk LIKE ? OR p.deskripsi LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (kategori) { where += ' AND p.id_kategori = ?'; params.push(kategori); }
    if (stok === 'habis')    where += ' AND p.stok = 0';
    if (stok === 'rendah')   where += ' AND p.stok > 0 AND p.stok <= 10';
    if (stok === 'tersedia') where += ' AND p.stok > 10';
    if (aktif === '1' || aktif === '0') {
      where += ' AND p.is_active = ?';
      params.push(Number(aktif));
    }

    const orderMap = {
      terbaru: 'p.id_produk DESC',
      terlama: 'p.id_produk ASC',
      nama_asc: 'p.nama_produk ASC',
      nama_desc: 'p.nama_produk DESC',
      termurah: 'p.harga ASC, p.nama_produk ASC',
      termahal: 'p.harga DESC, p.nama_produk ASC',
      stok_rendah: 'p.stok ASC, p.nama_produk ASC',
      stok_banyak: 'p.stok DESC, p.nama_produk ASC',
      kategori: 'k.nama_kategori ASC, p.nama_produk ASC'
    };
    const orderBy = orderMap[sort] || orderMap.terbaru;

    const [rows] = await db.query(`
      SELECT p.*, k.nama_kategori
      FROM produk p
      JOIN kategori k ON k.id_kategori = p.id_kategori
      WHERE ${where}
      ORDER BY ${orderBy}
    `, params);

    const [[counts]] = await db.query(`
      SELECT
        COUNT(*) AS total_produk,
        SUM(CASE WHEN stok = 0 THEN 1 ELSE 0 END)             AS stok_habis,
        SUM(CASE WHEN stok > 0 AND stok <= 10 THEN 1 ELSE 0 END) AS stok_rendah
      FROM produk
    `);
    const [[kategoriAktif]] = await db.query(`SELECT COUNT(*) AS total FROM kategori`);

    res.json({
      data: rows,
      counts: {
        total_produk: counts.total_produk || 0,
        stok_habis: counts.stok_habis || 0,
        stok_rendah: counts.stok_rendah || 0,
        kategori_aktif: kategoriAktif.total || 0
      }
    });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [[produk]] = await db.query(`
      SELECT p.*, k.nama_kategori
      FROM produk p
      JOIN kategori k ON k.id_kategori = p.id_kategori
      WHERE p.id_produk = ?
    `, [req.params.id]);
    if (!produk) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json(produk);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { id_kategori, nama_produk, deskripsi, harga, stok, berat_gram, is_active } = req.body || {};
    if (!nama_produk || !id_kategori || harga == null) {
      return res.status(400).json({ error: 'Kategori, nama, dan harga wajib diisi.' });
    }
    const [result] = await db.query(`
      INSERT INTO produk (id_kategori, nama_produk, deskripsi, harga, stok, berat_gram, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id_kategori, nama_produk, deskripsi || null, harga, stok || 0, berat_gram || 0, is_active ? 1 : 0]);
    res.status(201).json({ id_produk: result.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id_kategori, nama_produk, deskripsi, harga, stok, berat_gram, is_active } = req.body || {};
    const [result] = await db.query(`
      UPDATE produk SET id_kategori=?, nama_produk=?, deskripsi=?, harga=?, stok=?, berat_gram=?, is_active=?
      WHERE id_produk=?
    `, [id_kategori, nama_produk, deskripsi || null, harga, stok, berat_gram || 0, is_active ? 1 : 0, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM produk WHERE id_produk = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Tidak bisa menghapus produk yang masih dipakai pesanan.' });
  }
});

module.exports = router;
