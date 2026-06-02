const express = require('express');
const db = require('../../db');

const router = express.Router();

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function toSqlDateTime(value) {
  return value ? String(value).replace('T', ' ') : null;
}

async function syncOrderShipping(conn, idPesanan, ongkosKirim) {
  await conn.query(
    'UPDATE pesanan SET ongkos_kirim = ? WHERE id_pesanan = ?',
    [Number(ongkosKirim || 0), idPesanan]
  );
}

const ALLOWED_SHIPPING_STATUSES = [
  'diproses',
  'dalam_perjalanan',
  'tiba_di_kota',
  'out_for_delivery',
  'terkirim',
  'gagal_kirim',
  'retur'
];

function validateShippingStatus(res, statusKirim) {
  if (statusKirim && !ALLOWED_SHIPPING_STATUSES.includes(statusKirim)) {
    res.status(400).json({ error: 'Status pengiriman tidak valid.' });
    return false;
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT
        pg.*,
        kr.kode_kurir,
        kr.nama_kurir,
        pl.nama AS pelanggan_nama,
        p.status_pesanan
      FROM pengiriman pg
      JOIN master_kurir kr ON kr.id_kurir = pg.id_kurir
      JOIN pesanan p ON p.id_pesanan = pg.id_pesanan
      JOIN pelanggan pl ON pl.id_pelanggan = p.id_pelanggan
      ORDER BY pg.id_pengiriman DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/options', async (req, res, next) => {
  try {
    const [orders] = await db.query(`
      SELECT p.id_pesanan, p.total_tagihan, pl.nama AS pelanggan_nama
      FROM pesanan p
      JOIN pelanggan pl ON pl.id_pelanggan = p.id_pelanggan
      LEFT JOIN pengiriman pg ON pg.id_pesanan = p.id_pesanan
      WHERE pg.id_pengiriman IS NULL
      ORDER BY p.id_pesanan DESC
    `);
    const [kurir] = await db.query(`
      SELECT id_kurir, kode_kurir, nama_kurir
      FROM master_kurir
      WHERE is_active = 1
      ORDER BY id_kurir
    `);
    res.json({ orders, kurir });
  } catch (err) { next(err); }
});

router.get('/kurir-stats', async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT k.kode_kurir, k.nama_kurir,
        COUNT(pg.id_pengiriman) AS total,
        SUM(CASE WHEN pg.status_kirim = 'terkirim' THEN 1 ELSE 0 END) AS terkirim,
        SUM(CASE WHEN pg.status_kirim IN ('dalam_perjalanan','tiba_di_kota','out_for_delivery')
                 THEN 1 ELSE 0 END) AS perjalanan
      FROM master_kurir k
      LEFT JOIN pengiriman pg ON pg.id_kurir = k.id_kurir
      GROUP BY k.id_kurir, k.kode_kurir, k.nama_kurir
      ORDER BY k.id_kurir
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const {
      id_pesanan, id_kurir, layanan, no_resi, ongkos_kirim,
      total_berat_gram, tanggal_kirim, estimasi_tiba, status_kirim,
      catatan, lokasi_awal, deskripsi_awal
    } = req.body || {};

    if (!id_pesanan || !id_kurir || !no_resi || !estimasi_tiba) {
      return res.status(400).json({ error: 'Pesanan, kurir, resi, dan estimasi tiba wajib diisi.' });
    }
    if (!validateShippingStatus(res, status_kirim)) return;

    await conn.beginTransaction();
    const shippingFee = Number(ongkos_kirim || 0);
    const sentAt = toSqlDateTime(tanggal_kirim) || nowSql();
    const [result] = await conn.query(`
      INSERT INTO pengiriman
        (id_pesanan, id_kurir, layanan, no_resi, ongkos_kirim, total_berat_gram,
         tanggal_kirim, estimasi_tiba, status_kirim, catatan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id_pesanan,
      id_kurir,
      layanan || null,
      no_resi,
      shippingFee,
      Number(total_berat_gram || 0),
      sentAt,
      estimasi_tiba,
      status_kirim || 'diproses',
      catatan || null
    ]);
    await syncOrderShipping(conn, id_pesanan, shippingFee);

    const idPengiriman = result.insertId;
    if (deskripsi_awal) {
      await conn.query(`
        INSERT INTO riwayat_pengiriman
          (id_pengiriman, waktu_update, lokasi, deskripsi, status_kode)
        VALUES (?, ?, ?, ?, ?)
      `, [
        idPengiriman,
        sentAt,
        lokasi_awal || null,
        deskripsi_awal,
        status_kirim || 'diproses'
      ]);
    }

    await conn.commit();
    res.status(201).json({ id_pengiriman: idPengiriman });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const {
      id_kurir, layanan, no_resi, ongkos_kirim, total_berat_gram,
      tanggal_kirim, estimasi_tiba, tanggal_tiba, status_kirim, catatan
    } = req.body || {};

    if (!id_kurir || !no_resi || !estimasi_tiba) {
      return res.status(400).json({ error: 'Kurir, resi, dan estimasi tiba wajib diisi.' });
    }
    if (!validateShippingStatus(res, status_kirim)) return;

    await conn.beginTransaction();
    const [[existing]] = await conn.query(
      'SELECT id_pesanan FROM pengiriman WHERE id_pengiriman = ? FOR UPDATE',
      [req.params.id]
    );
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pengiriman tidak ditemukan.' });
    }

    const shippingFee = Number(ongkos_kirim || 0);
    const [result] = await conn.query(`
      UPDATE pengiriman
      SET id_kurir = ?, layanan = ?, no_resi = ?, ongkos_kirim = ?,
          total_berat_gram = ?, tanggal_kirim = ?, estimasi_tiba = ?,
          tanggal_tiba = ?, status_kirim = ?, catatan = ?
      WHERE id_pengiriman = ?
    `, [
      id_kurir,
      layanan || null,
      no_resi,
      shippingFee,
      Number(total_berat_gram || 0),
      toSqlDateTime(tanggal_kirim) || nowSql(),
      estimasi_tiba,
      toSqlDateTime(tanggal_tiba),
      status_kirim || 'diproses',
      catatan || null,
      req.params.id
    ]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pengiriman tidak ditemukan.' });
    }
    await syncOrderShipping(conn, existing.id_pesanan, shippingFee);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get('/track', async (req, res, next) => {
  try {
    const { q, kurir } = req.query;
    let tracking = null;

    if (q) {
      const [[row]] = await db.query(`
        SELECT pg.*, kr.kode_kurir, kr.nama_kurir
        FROM pengiriman pg
        JOIN master_kurir kr ON kr.id_kurir = pg.id_kurir
        WHERE pg.no_resi = ?
        LIMIT 1
      `, [q]);
      tracking = row || null;
    } else {
      const filter = kurir ? ' AND kr.kode_kurir = ?' : '';
      const args = kurir ? [kurir] : [];
      const [[row]] = await db.query(`
        SELECT pg.*, kr.kode_kurir, kr.nama_kurir
        FROM pengiriman pg
        JOIN master_kurir kr ON kr.id_kurir = pg.id_kurir
        WHERE pg.status_kirim IN ('dalam_perjalanan','out_for_delivery','tiba_di_kota','diproses')
        ${filter}
        ORDER BY pg.tanggal_kirim DESC
        LIMIT 1
      `, args);
      tracking = row || null;
    }

    if (!tracking) return res.json({ tracking: null });

    const [riwayat] = await db.query(`
      SELECT * FROM riwayat_pengiriman WHERE id_pengiriman = ?
      ORDER BY waktu_update ASC
    `, [tracking.id_pengiriman]);

    const [[pesanan]] = await db.query(`
      SELECT p.*, pl.nama AS pelanggan_nama,
             a.penerima, a.no_hp_penerima, a.alamat_lengkap, a.kota, a.provinsi, a.kode_pos
      FROM pesanan p
      JOIN pelanggan pl ON pl.id_pelanggan = p.id_pelanggan
      JOIN alamat a ON a.id_alamat = p.id_alamat
      WHERE p.id_pesanan = ?
    `, [tracking.id_pesanan]);

    const [items] = await db.query(`
      SELECT dp.*, pr.nama_produk
      FROM detail_pesanan dp
      JOIN produk pr ON pr.id_produk = dp.id_produk
      WHERE dp.id_pesanan = ?
    `, [tracking.id_pesanan]);

    const [[bayar]] = await db.query('SELECT * FROM pembayaran WHERE id_pesanan = ?', [tracking.id_pesanan]);

    res.json({ tracking, riwayat, pesanan, items, bayar: bayar || null });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM pengiriman WHERE id_pengiriman = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pengiriman tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Tidak bisa menghapus pengiriman ini.' });
  }
});

module.exports = router;
