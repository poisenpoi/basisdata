const express = require('express');
const db = require('../../db');

const router = express.Router();

function toSqlDateTime(value) {
  return value ? String(value).replace('T', ' ') : null;
}

const ALLOWED_METHODS = ['transfer_bank', 'e_wallet', 'cod'];
const ALLOWED_STATUSES = ['pending', 'berhasil', 'gagal', 'refund'];

function validatePayment(res, metode, statusBayar) {
  if (!ALLOWED_METHODS.includes(metode)) {
    res.status(400).json({ error: 'Metode pembayaran tidak valid.' });
    return false;
  }
  if (statusBayar && !ALLOWED_STATUSES.includes(statusBayar)) {
    res.status(400).json({ error: 'Status pembayaran tidak valid.' });
    return false;
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const { status, metode } = req.query;
    let where = '1=1';
    const params = [];
    if (status) { where += ' AND pay.status_bayar = ?'; params.push(status); }
    if (metode) { where += ' AND pay.metode = ?';      params.push(metode); }

    const [rows] = await db.query(`
      SELECT pay.*, p.id_pesanan,
        pl.nama AS pelanggan_nama, pl.email AS pelanggan_email
      FROM pembayaran pay
      JOIN pesanan p ON p.id_pesanan = pay.id_pesanan
      JOIN pelanggan pl ON pl.id_pelanggan = p.id_pelanggan
      WHERE ${where}
      ORDER BY pay.id_pembayaran DESC
    `, params);

    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/options', async (req, res, next) => {
  try {
    const [orders] = await db.query(`
      SELECT p.id_pesanan, p.total_tagihan, p.status_pesanan, pl.nama AS pelanggan_nama
      FROM pesanan p
      JOIN pelanggan pl ON pl.id_pelanggan = p.id_pelanggan
      LEFT JOIN pembayaran pay ON pay.id_pesanan = p.id_pesanan
      WHERE pay.id_pembayaran IS NULL
      ORDER BY p.id_pesanan DESC
    `);
    res.json({ orders });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { id_pesanan, metode, nama_penyedia, jumlah_bayar, tanggal_bayar, status_bayar } = req.body || {};
    if (!id_pesanan || !metode || jumlah_bayar == null) {
      return res.status(400).json({ error: 'Pesanan, metode, dan jumlah bayar wajib diisi.' });
    }
    if (!validatePayment(res, metode, status_bayar)) return;
    const [result] = await db.query(`
      INSERT INTO pembayaran
        (id_pesanan, metode, nama_penyedia, jumlah_bayar, tanggal_bayar, status_bayar)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      id_pesanan,
      metode,
      nama_penyedia || null,
      jumlah_bayar,
      toSqlDateTime(tanggal_bayar),
      status_bayar || 'pending'
    ]);
    res.status(201).json({ id_pembayaran: result.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { metode, nama_penyedia, jumlah_bayar, tanggal_bayar, status_bayar } = req.body || {};
    if (!metode || jumlah_bayar == null) {
      return res.status(400).json({ error: 'Metode dan jumlah bayar wajib diisi.' });
    }
    if (!validatePayment(res, metode, status_bayar)) return;
    const [result] = await db.query(`
      UPDATE pembayaran
      SET metode = ?, nama_penyedia = ?, jumlah_bayar = ?, tanggal_bayar = ?, status_bayar = ?
      WHERE id_pembayaran = ?
    `, [
      metode,
      nama_penyedia || null,
      jumlah_bayar,
      toSqlDateTime(tanggal_bayar),
      status_bayar || 'pending',
      req.params.id
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM pembayaran WHERE id_pembayaran = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Tidak bisa menghapus pembayaran ini.' });
  }
});

module.exports = router;
