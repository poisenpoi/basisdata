const express = require('express');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Masuk - TokoKita', layout: false });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/', requireAuth, (req, res) => {
  res.render('dashboard', {
    title: 'Dashboard - TokoKita',
    pageTitle: 'Dashboard',
    breadcrumb: 'Home / Dashboard'
  });
});

router.get('/produk', requireAuth, (req, res) => {
  res.render('produk/index', {
    title: 'Manajemen Produk - TokoKita',
    pageTitle: 'Manajemen Produk',
    breadcrumb: 'Home / Produk'
  });
});

router.get('/produk/baru', requireAuth, (req, res) => {
  res.render('produk/form', {
    title: 'Tambah Produk - TokoKita',
    pageTitle: 'Tambah Produk',
    breadcrumb: 'Home / Produk / Tambah',
    mode: 'create',
    idProduk: null
  });
});

router.get('/produk/:id/edit', requireAuth, (req, res) => {
  res.render('produk/form', {
    title: 'Edit Produk - TokoKita',
    pageTitle: 'Edit Produk',
    breadcrumb: 'Home / Produk / Edit',
    mode: 'edit',
    idProduk: req.params.id
  });
});

router.get('/pesanan', requireAuth, (req, res) => {
  res.render('pesanan/index', {
    title: 'Daftar Pesanan - TokoKita',
    pageTitle: 'Daftar Pesanan',
    breadcrumb: 'Home / Pesanan'
  });
});

router.get('/pesanan/:id', requireAuth, (req, res) => {
  res.render('pesanan/detail', {
    title: `Pesanan #TK - TokoKita`,
    pageTitle: 'Detail Pesanan',
    breadcrumb: 'Home / Pesanan / Detail',
    idPesanan: req.params.id
  });
});

router.get('/pengiriman', requireAuth, (req, res) => {
  res.render('pengiriman/index', {
    title: 'Pengiriman - TokoKita',
    pageTitle: 'Pengiriman - Tracking Paket',
    breadcrumb: 'Home / Pengiriman'
  });
});

router.get('/pengiriman/:id/edit', requireAuth, (req, res) => {
  res.render('pengiriman/form', {
    title: 'Edit Pengiriman - TokoKita',
    pageTitle: 'Edit Pengiriman',
    breadcrumb: 'Home / Pengiriman / Edit',
    idPengiriman: req.params.id
  });
});

router.get('/pembayaran', requireAuth, (req, res) => {
  res.render('pembayaran/index', {
    title: 'Pembayaran - TokoKita',
    pageTitle: 'Daftar Pembayaran',
    breadcrumb: 'Home / Pembayaran'
  });
});

router.get('/pembayaran/:id/edit', requireAuth, (req, res) => {
  res.render('pembayaran/form', {
    title: 'Edit Pembayaran - TokoKita',
    pageTitle: 'Edit Pembayaran',
    breadcrumb: 'Home / Pembayaran / Edit',
    idPembayaran: req.params.id
  });
});

router.get('/pelanggan', requireAuth, (req, res) => {
  res.render('pelanggan/index', {
    title: 'Pelanggan - TokoKita',
    pageTitle: 'Daftar Pelanggan',
    breadcrumb: 'Home / Pelanggan'
  });
});

router.get('/pelanggan/:id/edit', requireAuth, (req, res) => {
  res.render('pelanggan/form', {
    title: 'Edit Pelanggan - TokoKita',
    pageTitle: 'Edit Pelanggan',
    breadcrumb: 'Home / Pelanggan / Edit',
    idPelanggan: req.params.id
  });
});

router.get('/pelanggan/:id', requireAuth, (req, res) => {
  res.render('pelanggan/detail', {
    title: 'Detail Pelanggan - TokoKita',
    pageTitle: 'Detail Pelanggan',
    breadcrumb: 'Home / Pelanggan / Detail',
    idPelanggan: req.params.id
  });
});

router.get('/master', requireAuth, (req, res) => {
  res.render('master/index', {
    title: 'Master Data - TokoKita',
    pageTitle: 'Master Data',
    breadcrumb: 'Home / Master Data'
  });
});

router.get('/master/kategori/:id/edit', requireAuth, (req, res) => {
  res.render('master/kategori-form', {
    title: 'Edit Kategori - TokoKita',
    pageTitle: 'Edit Kategori',
    breadcrumb: 'Home / Master Data / Kategori / Edit',
    idKategori: req.params.id
  });
});

router.get('/master/kurir/:id/edit', requireAuth, (req, res) => {
  res.render('master/kurir-form', {
    title: 'Edit Kurir - TokoKita',
    pageTitle: 'Edit Kurir',
    breadcrumb: 'Home / Master Data / Kurir / Edit',
    idKurir: req.params.id
  });
});

module.exports = router;
