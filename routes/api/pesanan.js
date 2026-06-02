const express = require('express');
const db = require('../../db');

const router = express.Router();

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function toSqlDateTime(value) {
  return value ? String(value).replace('T', ' ') : null;
}

async function recalcOrderTotal(conn, idPesanan) {
  const [[sumRow]] = await conn.query(`
    SELECT COALESCE(SUM(subtotal), 0) AS total_harga
    FROM detail_pesanan
    WHERE id_pesanan = ?
  `, [idPesanan]);
  await conn.query(
    'UPDATE pesanan SET total_harga = ? WHERE id_pesanan = ?',
    [sumRow.total_harga || 0, idPesanan]
  );
}

router.get('/', async (req, res, next) => {
  try {
    const { status, q, bayar_status, metode, has_shipping, kurir, sort } = req.query;
    let where = '1=1';
    const params = [];
    if (status && status !== 'semua') {
      where += ' AND p.status_pesanan = ?';
      params.push(status);
    }
    if (q) {
      where += ' AND (pl.nama LIKE ? OR pl.email LIKE ? OR p.id_pesanan = ?)';
      params.push(`%${q}%`, `%${q}%`, isNaN(parseInt(q)) ? 0 : parseInt(q));
    }
    if (bayar_status === 'belum_bayar') {
      where += ' AND pay.id_pembayaran IS NULL';
    } else if (bayar_status) {
      where += ' AND pay.status_bayar = ?';
      params.push(bayar_status);
    }
    if (metode) {
      where += ' AND pay.metode = ?';
      params.push(metode);
    }
    if (has_shipping === 'ya') {
      where += ' AND pg.id_pengiriman IS NOT NULL';
    } else if (has_shipping === 'tidak') {
      where += ' AND pg.id_pengiriman IS NULL';
    }
    if (kurir) {
      where += ' AND kr.kode_kurir = ?';
      params.push(kurir);
    }

    const orderMap = {
      tanggal_desc: 'p.tanggal_pesan DESC, p.id_pesanan DESC',
      tanggal_asc: 'p.tanggal_pesan ASC, p.id_pesanan ASC',
      total_desc: 'p.total_tagihan DESC, p.id_pesanan DESC',
      total_asc: 'p.total_tagihan ASC, p.id_pesanan ASC',
      pelanggan_asc: 'pl.nama ASC, p.tanggal_pesan DESC',
      pelanggan_desc: 'pl.nama DESC, p.tanggal_pesan DESC',
      status: 'p.status_pesanan ASC, p.tanggal_pesan DESC'
    };
    const orderBy = orderMap[sort] || orderMap.tanggal_desc;

    const [rows] = await db.query(`
      SELECT
        p.id_pesanan, p.tanggal_pesan, p.total_tagihan, p.status_pesanan,
        pl.nama AS pelanggan_nama, pl.email AS pelanggan_email,
        pay.metode AS bayar_metode, pay.nama_penyedia AS bayar_penyedia,
        pay.status_bayar, kr.kode_kurir
      FROM pesanan p
      JOIN pelanggan pl ON pl.id_pelanggan = p.id_pelanggan
      LEFT JOIN pembayaran pay ON pay.id_pesanan = p.id_pesanan
      LEFT JOIN pengiriman pg  ON pg.id_pesanan = p.id_pesanan
      LEFT JOIN master_kurir kr ON kr.id_kurir = pg.id_kurir
      WHERE ${where}
      ORDER BY ${orderBy}
    `, params);

    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/options', async (req, res, next) => {
  try {
    const [alamat] = await db.query(`
      SELECT
        a.id_alamat,
        a.id_pelanggan,
        a.label,
        a.penerima,
        a.kota,
        a.provinsi,
        pl.nama AS pelanggan_nama
      FROM alamat a
      JOIN pelanggan pl ON pl.id_pelanggan = a.id_pelanggan
      ORDER BY pl.nama ASC, a.is_utama DESC, a.id_alamat ASC
    `);
    const [produk] = await db.query(`
      SELECT id_produk, nama_produk, harga, stok
      FROM produk
      WHERE is_active = 1
      ORDER BY nama_produk ASC
    `);
    res.json({ alamat, produk });
  } catch (err) { next(err); }
});

router.get('/counts', async (req, res, next) => {
  try {
    const [counts] = await db.query(`
      SELECT status_pesanan, COUNT(*) AS total FROM pesanan GROUP BY status_pesanan
    `);
    const cmap = {};
    counts.forEach(c => cmap[c.status_pesanan] = c.total);
    const [[totalAll]] = await db.query('SELECT COUNT(*) AS total FROM pesanan');
    res.json({
      semua: totalAll.total,
      menunggu_bayar: cmap.menunggu_bayar || 0,
      diproses:       cmap.diproses       || 0,
      dikirim:        cmap.dikirim        || 0,
      selesai:        cmap.selesai        || 0,
      dibatalkan:     cmap.dibatalkan     || 0
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const {
      id_alamat, id_produk, jumlah, ongkos_kirim, diskon, status_pesanan, tanggal_pesan
    } = req.body || {};

    const qty = Number(jumlah || 0);
    if (!id_alamat || !id_produk || qty <= 0) {
      return res.status(400).json({ error: 'Alamat, produk, dan jumlah wajib diisi.' });
    }

    const allowed = ['menunggu_bayar', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];
    const status = allowed.includes(status_pesanan) ? status_pesanan : 'menunggu_bayar';

    await conn.beginTransaction();

    const [[alamat]] = await conn.query(
      'SELECT id_pelanggan FROM alamat WHERE id_alamat = ?',
      [id_alamat]
    );
    if (!alamat) {
      await conn.rollback();
      return res.status(404).json({ error: 'Alamat tidak ditemukan.' });
    }

    const [[produk]] = await conn.query(
      'SELECT harga FROM produk WHERE id_produk = ?',
      [id_produk]
    );
    if (!produk) {
      await conn.rollback();
      return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    }

    const totalHarga = Number(produk.harga) * qty;
    const [result] = await conn.query(`
      INSERT INTO pesanan
        (id_pelanggan, id_alamat, tanggal_pesan, total_harga, ongkos_kirim, diskon, status_pesanan)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      alamat.id_pelanggan,
      id_alamat,
      toSqlDateTime(tanggal_pesan) || nowSql(),
      totalHarga,
      Number(ongkos_kirim || 0),
      Number(diskon || 0),
      status
    ]);

    const idPesanan = result.insertId;
    await conn.query(`
      INSERT INTO detail_pesanan (id_pesanan, id_produk, jumlah, harga_satuan)
      VALUES (?, ?, ?, ?)
    `, [idPesanan, id_produk, qty, produk.harga]);

    await conn.commit();
    res.status(201).json({ id_pesanan: idPesanan });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [[pesanan]] = await db.query(`
      SELECT p.*, pl.nama AS pelanggan_nama, pl.email AS pelanggan_email, pl.no_hp,
             a.label, a.penerima, a.no_hp_penerima, a.alamat_lengkap,
             a.kota, a.provinsi, a.kode_pos
      FROM pesanan p
      JOIN pelanggan pl ON pl.id_pelanggan = p.id_pelanggan
      JOIN alamat a ON a.id_alamat = p.id_alamat
      WHERE p.id_pesanan = ?
    `, [req.params.id]);
    if (!pesanan) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

    const [items] = await db.query(`
      SELECT dp.*, pr.nama_produk
      FROM detail_pesanan dp
      JOIN produk pr ON pr.id_produk = dp.id_produk
      WHERE dp.id_pesanan = ?
    `, [req.params.id]);

    const [[bayar]] = await db.query('SELECT * FROM pembayaran WHERE id_pesanan = ?', [req.params.id]);
    const [[kirim]] = await db.query(`
      SELECT pg.*, kr.kode_kurir, kr.nama_kurir
      FROM pengiriman pg
      LEFT JOIN master_kurir kr ON kr.id_kurir = pg.id_kurir
      WHERE pg.id_pesanan = ?
    `, [req.params.id]);

    res.json({ pesanan, items, bayar: bayar || null, kirim: kirim || null });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { id_alamat, tanggal_pesan, ongkos_kirim, diskon, status_pesanan } = req.body || {};
    const shippingFee = Number(ongkos_kirim || 0);
    const allowed = ['menunggu_bayar', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];
    if (status_pesanan && !allowed.includes(status_pesanan)) {
      return res.status(400).json({ error: 'Status tidak valid.' });
    }

    await conn.beginTransaction();
    let idPelanggan = null;
    if (id_alamat) {
      const [[alamat]] = await conn.query('SELECT id_pelanggan FROM alamat WHERE id_alamat = ?', [id_alamat]);
      if (!alamat) {
        await conn.rollback();
        return res.status(404).json({ error: 'Alamat tidak ditemukan.' });
      }
      idPelanggan = alamat.id_pelanggan;
    }

    const [result] = await conn.query(`
      UPDATE pesanan SET
        id_pelanggan = COALESCE(?, id_pelanggan),
        id_alamat = COALESCE(?, id_alamat),
        tanggal_pesan = COALESCE(?, tanggal_pesan),
        ongkos_kirim = ?,
        diskon = ?,
        status_pesanan = COALESCE(?, status_pesanan)
      WHERE id_pesanan = ?
    `, [
      idPelanggan,
      id_alamat || null,
      toSqlDateTime(tanggal_pesan),
      shippingFee,
      Number(diskon || 0),
      status_pesanan || null,
      req.params.id
    ]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    }

    await conn.query(
      'UPDATE pengiriman SET ongkos_kirim = ? WHERE id_pesanan = ?',
      [shippingFee, req.params.id]
    );
    await recalcOrderTotal(conn, req.params.id);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.post('/:id/items', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { id_produk, jumlah, harga_satuan } = req.body || {};
    const qty = Number(jumlah || 0);
    if (!id_produk || qty <= 0) {
      return res.status(400).json({ error: 'Produk dan jumlah wajib diisi.' });
    }

    await conn.beginTransaction();
    const [[pesanan]] = await conn.query('SELECT id_pesanan FROM pesanan WHERE id_pesanan = ?', [req.params.id]);
    if (!pesanan) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    }

    const [[produk]] = await conn.query('SELECT harga FROM produk WHERE id_produk = ?', [id_produk]);
    if (!produk) {
      await conn.rollback();
      return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    }

    const [result] = await conn.query(`
      INSERT INTO detail_pesanan (id_pesanan, id_produk, jumlah, harga_satuan)
      VALUES (?, ?, ?, ?)
    `, [req.params.id, id_produk, qty, harga_satuan == null ? produk.harga : harga_satuan]);

    await recalcOrderTotal(conn, req.params.id);
    await conn.commit();
    res.status(201).json({ id_detail: result.insertId });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.put('/:id/items/:detailId', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    const { id_produk, jumlah, harga_satuan } = req.body || {};
    const qty = Number(jumlah || 0);
    if (!id_produk || qty <= 0 || harga_satuan == null) {
      return res.status(400).json({ error: 'Produk, jumlah, dan harga satuan wajib diisi.' });
    }

    await conn.beginTransaction();
    const [result] = await conn.query(`
      UPDATE detail_pesanan
      SET id_produk = ?, jumlah = ?, harga_satuan = ?
      WHERE id_detail = ? AND id_pesanan = ?
    `, [id_produk, qty, harga_satuan, req.params.detailId, req.params.id]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Detail pesanan tidak ditemukan.' });
    }

    await recalcOrderTotal(conn, req.params.id);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.delete('/:id/items/:detailId', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'DELETE FROM detail_pesanan WHERE id_detail = ? AND id_pesanan = ?',
      [req.params.detailId, req.params.id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Detail pesanan tidak ditemukan.' });
    }
    await recalcOrderTotal(conn, req.params.id);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(409).json({ error: 'Tidak bisa menghapus detail pesanan ini.' });
  } finally {
    conn.release();
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const allowed = ['menunggu_bayar', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];
    const { status } = req.body || {};
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid.' });
    }
    const [r] = await db.query(
      'UPDATE pesanan SET status_pesanan = ? WHERE id_pesanan = ?',
      [status, req.params.id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM pesanan WHERE id_pesanan = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: 'Tidak bisa menghapus pesanan ini.' });
  }
});

module.exports = router;
