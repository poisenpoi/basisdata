const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { q, status } = req.query;
    let where = '1=1';
    const params = [];
    if (q) {
      where += ' AND (pl.nama LIKE ? OR pl.email LIKE ? OR pl.no_hp LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) { where += ' AND pl.status_akun = ?'; params.push(status); }

    const [rows] = await db.query(`
      SELECT pl.*,
        (SELECT COUNT(*) FROM pesanan p WHERE p.id_pelanggan = pl.id_pelanggan) AS total_pesanan,
        (SELECT COALESCE(SUM(p.total_tagihan), 0) FROM pesanan p
           WHERE p.id_pelanggan = pl.id_pelanggan
             AND p.status_pesanan IN ('selesai','dikirim')) AS total_belanja
      FROM pelanggan pl
      WHERE ${where}
      ORDER BY pl.id_pelanggan DESC
    `, params);

    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const {
      nama, email, password, no_hp, status_akun,
      label, penerima, no_hp_penerima, alamat_lengkap, kota, provinsi, kode_pos
    } = req.body || {};

    if (!nama || !email || !no_hp) {
      return res.status(400).json({ error: 'Nama, email, dan no. HP wajib diisi.' });
    }

    await conn.beginTransaction();
    const [result] = await conn.query(`
      INSERT INTO pelanggan (nama, email, password, no_hp, status_akun)
      VALUES (?, ?, ?, ?, ?)
    `, [nama, email, password || 'password123', no_hp, status_akun || 'aktif']);

    const idPelanggan = result.insertId;
    if (alamat_lengkap && kota && provinsi && kode_pos) {
      await conn.query(`
        INSERT INTO alamat
          (id_pelanggan, label, penerima, no_hp_penerima, alamat_lengkap, kota, provinsi, kode_pos, is_utama)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        idPelanggan,
        label || 'Rumah',
        penerima || nama,
        no_hp_penerima || no_hp,
        alamat_lengkap,
        kota,
        provinsi,
        kode_pos
      ]);
    }

    await conn.commit();
    res.status(201).json({ id_pelanggan: idPelanggan });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { nama, email, password, no_hp, status_akun } = req.body || {};
    if (!nama || !email || !no_hp) {
      return res.status(400).json({ error: 'Nama, email, dan no. HP wajib diisi.' });
    }
    const params = [nama, email, no_hp, status_akun || 'aktif'];
    let sql = `
      UPDATE pelanggan
      SET nama = ?, email = ?, no_hp = ?, status_akun = ?
    `;
    if (password) {
      sql += ', password = ?';
      params.push(password);
    }
    sql += ' WHERE id_pelanggan = ?';
    params.push(req.params.id);

    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM pelanggan WHERE id_pelanggan = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Tidak bisa menghapus pelanggan yang masih memiliki pesanan.' });
  }
});

module.exports = router;
