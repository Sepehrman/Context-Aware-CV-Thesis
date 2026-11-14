// ============================================================
// RQ4 Test 2 layers (file renamed 11 Nov 2026, was rq4_step8_followup_layers.js).
// Extra layers for the Question 7 forecast test (Test 2), written 20 Oct 2026.
// Run in the Earth Engine Code Editor, then click RUN on every task in the Tasks tab.
// All files go to the same Drive folder (rq4_s2) on the same 1 km grid as Steps 4 and 5.
//
//   rq4_static_<square>.tif  land cover shares and terrain (one band each, no dates)
//        tree, shrub, grass, wetland : share of the 1 km cell in WorldCover v200 classes 10, 20, 30, 90
//        elev                         : mean elevation (m), CDEM
//        slope                        : mean slope (degrees), CDEM
//        northness, eastness          : mean cos and sin of aspect, CDEM
//   rq4_snow_<square>.tif    ERA5-Land monthly snow, March to May 2016 to 2025
//        swe_YYYY_MM                  : snow_depth_water_equivalent (m of water)
//        snowc_YYYY_MM                : snow_cover (fraction 0 to 1)
//   rq4_l1c_<square>.tif     Sentinel-2 Level-1C (harmonized), April and May 2016 to 2025
//        gcc_YYYY_MM                  : G / (R + G + B) of the monthly median, computed at 10 m, mean per 1 km cell
//        n_clear_YYYY_MM              : mean number of clear observations per 10 m pixel in the cell
//
// Why L1C: the Level-2A record in Earth Engine is sparse before 2019 (Step 2). To compare each
// year only with EARLIER years (supervisor question 6) from 2019 onward, earlier spring images are
// needed. The Level-1C record starts in June 2015. Cloud masking is the same as Step 4.
// ============================================================

var CRS = 'EPSG:3005';
var DRIVE_FOLDER = 'rq4_s2';
var CS_THRESHOLD = 0.60;

var squares = ee.FeatureCollection('projects/rosy-ratio-511703-q3/assets/rq4_squares')
    .filter(ee.Filter.neq('square_id', 'Coastal_1'));

function tag(y, m) { return y + '_' + (m < 10 ? '0' : '') + m; }
function empty(names) {
  return ee.Image.constant(names.map(function() { return 0; })).rename(names)
      .toFloat().updateMask(ee.Image(0));
}

// ---------- 1. Static layers: land cover shares and terrain ----------
var wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map');
function share(cls, name) { return wc.eq(cls).unmask(0).rename(name).toFloat(); }
var cover = ee.Image.cat([share(10, 'tree'), share(20, 'shrub'), share(30, 'grass'), share(90, 'wetland')])
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 65535});

var cdemCol = ee.ImageCollection('NRCan/CDEM');
var dem = cdemCol.select('elevation').mosaic().setDefaultProjection(cdemCol.first().projection());
var terr = ee.Terrain.products(dem);
var aspectRad = terr.select('aspect').multiply(Math.PI / 180);
var terrain = ee.Image.cat([
      terr.select('elevation').rename('elev'),
      terr.select('slope').rename('slope'),
      aspectRad.cos().rename('northness'),
      aspectRad.sin().rename('eastness')]).toFloat()
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 65535});

var staticImg = cover.addBands(terrain);

// ---------- 2. ERA5-Land snow, March to May ----------
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR');
var snowBands = [];
for (var y = 2016; y <= 2025; y++) {
  for (var m = 3; m <= 5; m++) {
    var start = ee.Date.fromYMD(y, m, 1);
    var names = ['swe_' + tag(y, m), 'snowc_' + tag(y, m)];
    var img = era5.filterDate(start, start.advance(1, 'month'))
        .map(function(i) {
          return i.select(['snow_depth_water_equivalent', 'snow_cover']).rename(names).toFloat();
        })
        .merge(ee.ImageCollection([empty(names)])).mean();
    snowBands.push(img);
  }
}
var snowImg = ee.Image.cat(snowBands);

// ---------- 3. Sentinel-2 Level-1C, April and May 2016 to 2025 ----------
var s2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED');
var csp = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

function l1cMonth(region, y, m) {
  var start = ee.Date.fromYMD(y, m, 1);
  var names = ['gcc_' + tag(y, m), 'n_clear_' + tag(y, m)];
  var col = s2.filterBounds(region).filterDate(start, start.advance(1, 'month'))
      .linkCollection(csp, ['cs_cdf'])
      .map(function(img) { return img.set('has_cs', img.bandNames().contains('cs_cdf')); })
      .filter(ee.Filter.eq('has_cs', true))
      .map(function(img) {
        var clear = img.select('cs_cdf').gte(CS_THRESHOLD);
        return img.select(['B4', 'B3', 'B2']).multiply(0.0001).updateMask(clear)
            .addBands(clear.rename('clear').toFloat()).toFloat();
      })
      // fully masked placeholder: a month without images gives "no data" instead of an error
      .merge(ee.ImageCollection([empty(['B4', 'B3', 'B2', 'clear'])]));
  var med = col.select(['B4', 'B3', 'B2']).median();
  var tot = med.select('B4').add(med.select('B3')).add(med.select('B2'));
  var gcc = med.select('B3').divide(tot);
  var nClear = col.select('clear').sum().unmask(0);
  var out = ee.Image.cat([gcc, nClear]).rename(names).toFloat()
      .setDefaultProjection({crs: CRS, scale: 10});
  return out.reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 65535});
}

// ---------- exports ----------
var info = squares.toList(20).map(function(f) {
  return ee.Feature(f).toDictionary(['square_id', 'xmin', 'ymin', 'xmax', 'ymax']);
}).getInfo();

function exportOne(image, name, geom, sq) {
  Export.image.toDrive({
    image: image.toFloat(), description: name, folder: DRIVE_FOLDER, region: geom, crs: CRS,
    crsTransform: [1000, 0, sq.xmin, 0, -1000, sq.ymax], maxPixels: 1e9, shardSize: 20,
    fileFormat: 'GeoTIFF'
  });
}

info.forEach(function(sq) {
  var geom = ee.Geometry.Rectangle([sq.xmin, sq.ymin, sq.xmax, sq.ymax], CRS, false);
  exportOne(staticImg, 'rq4_static_' + sq.square_id, geom, sq);
  exportOne(snowImg, 'rq4_snow_' + sq.square_id, geom, sq);
  var l1cBands = [];
  for (var y = 2016; y <= 2025; y++) {
    for (var m = 4; m <= 5; m++) { l1cBands.push(l1cMonth(geom, y, m)); }
  }
  exportOne(ee.Image.cat(l1cBands), 'rq4_l1c_' + sq.square_id, geom, sq);
});

print('Export tasks created:', info.length * 3, '(static, snow and L1C for each square)');
