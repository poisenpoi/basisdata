const express = require('express');
const db = require('../../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { q, status, has_order, order_status, sort } = req.query;
    let where = '1=1';
    const params = [];
    if (q) {
      where += ' AND (pl.nama LIKE ? OR pl.email LIKE ? OR pl.no_hp LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) { where += ' AND pl.status_akun = ?'; params.push(status); }
    if (has_order === 'ya') {
      where += ' AND EXISTS (SELECT 1 FROM pesanan p_has WHERE p_has.id_pelanggan = pl.id_pelanggan)';
    } else if (has_order === 'tidak') {
      where += ' AND NOT EXISTS (SELECT 1 FROM pesanan p_has WHERE p_has.id_pelanggan = pl.id_pelanggan)';
    }
    if (order_status) {
      where += ` AND EXISTS (
        SELECT 1 FROM pesanan p_status
        WHERE p_status.id_pelanggan = pl.id_pelanggan
          AND p_status.status_pesanan = ?
      )`;
      params.push(order_status);
    }

    const orderMap = {
      terbaru: 'pl.tanggal_daftar DESC, pl.id_pelanggan DESC',
      terlama: 'pl.tanggal_daftar ASC, pl.id_pelanggan ASC',
      nama_asc: 'pl.nama ASC, pl.id_pelanggan ASC',
      nama_desc: 'pl.nama DESC, pl.id_pelanggan DESC',
      pesanan_terbanyak: 'total_pesanan DESC, pl.nama ASC',
      pesanan_tersedikit: 'total_pesanan ASC, pl.nama ASC',
      belanja_terbesar: 'total_belanja DESC, pl.nama ASC',
      belanja_terkecil: 'total_belanja ASC, pl.nama ASC'
    };
    const orderBy = orderMap[sort] || orderMap.terbaru;

    const [rows] = await db.query(`
      SELECT pl.*,
        (SELECT COUNT(*) FROM pesanan p WHERE p.id_pelanggan = pl.id_pelanggan) AS total_pesanan,
        (SELECT COALESCE(SUM(p.total_tagihan), 0) FROM pesanan p
           WHERE p.id_pelanggan = pl.id_pelanggan
             AND p.status_pesanan IN ('selesai','dikirim')) AS total_belanja
      FROM pelanggan pl
      WHERE ${where}
      ORDER BY ${orderBy}
    `, params);

    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id/orders', async (req, res, next) => {
  try {
    const { status, sort } = req.query;
    const [[pelanggan]] = await db.query(
      'SELECT id_pelanggan FROM pelanggan WHERE id_pelanggan = ?',
      [req.params.id]
    );
    if (!pelanggan) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });

    let where = 'p.id_pelanggan = ?';
    const params = [req.params.id];
    if (status && status !== 'semua') {
      where += ' AND p.status_pesanan = ?';
      params.push(status);
    }

    const orderMap = {
      tanggal_desc: 'p.tanggal_pesan DESC, p.id_pesanan DESC',
      tanggal_asc: 'p.tanggal_pesan ASC, p.id_pesanan ASC',
      total_desc: 'p.total_tagihan DESC, p.id_pesanan DESC',
      total_asc: 'p.total_tagihan ASC, p.id_pesanan ASC',
      status: 'p.status_pesanan ASC, p.tanggal_pesan DESC'
    };
    const orderBy = orderMap[sort] || orderMap.tanggal_desc;

    const [rows] = await db.query(`
      SELECT
        p.id_pesanan, p.tanggal_pesan, p.total_tagihan, p.status_pesanan,
        pay.metode AS bayar_metode, pay.nama_penyedia AS bayar_penyedia,
        pay.status_bayar, kr.kode_kurir,
        (SELECT COUNT(*) FROM detail_pesanan dp
          WHERE dp.id_pesanan = p.id_pesanan) AS total_item,
        (SELECT pr.nama_produk
          FROM detail_pesanan dp
          JOIN produk pr ON pr.id_produk = dp.id_produk
          WHERE dp.id_pesanan = p.id_pesanan
          ORDER BY dp.id_detail ASC
          LIMIT 1) AS produk_utama
      FROM pesanan p
      LEFT JOIN pembayaran pay ON pay.id_pesanan = p.id_pesanan
      LEFT JOIN pengiriman pg  ON pg.id_pesanan = p.id_pesanan
      LEFT JOIN master_kurir kr ON kr.id_kurir = pg.id_kurir
      WHERE ${where}
      ORDER BY ${orderBy}
    `, params);

    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [[row]] = await db.query(`
      SELECT pl.*,
        (SELECT COUNT(*) FROM pesanan p WHERE p.id_pelanggan = pl.id_pelanggan) AS total_pesanan,
        (SELECT COALESCE(SUM(p.total_tagihan), 0) FROM pesanan p
           WHERE p.id_pelanggan = pl.id_pelanggan
             AND p.status_pesanan IN ('selesai','dikirim')) AS total_belanja,
        (SELECT COALESCE(SUM(p.total_tagihan), 0) FROM pesanan p
           WHERE p.id_pelanggan = pl.id_pelanggan
             AND p.status_pesanan = 'menunggu_bayar') AS tagihan_menunggu
      FROM pelanggan pl
      WHERE pl.id_pelanggan = ?
    `, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
    const [alamat] = await db.query(`
      SELECT *
      FROM alamat
      WHERE id_pelanggan = ?
      ORDER BY is_utama DESC, id_alamat ASC
    `, [req.params.id]);
    res.json({ ...row, alamat });
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
