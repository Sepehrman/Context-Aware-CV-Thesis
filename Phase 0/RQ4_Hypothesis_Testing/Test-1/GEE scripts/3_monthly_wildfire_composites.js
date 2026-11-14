// ============================================================
// RQ4 Step 4a: test export of monthly composites, ONE square, ONE year
// ============================================================
var SQUARE_ID = 'Kamloops_1';
var YEAR = 2023;

var CRS = 'EPSG:3005';
var CS_THRESHOLD = 0.60;              // Cloud Score+ clear threshold
var MONTHS = [4, 5, 6, 7, 8, 9, 10];  // April to October
var BANDS = ['red', 'green', 'blue', 'gcc', 'rcc', 'bright', 'snow_frac', 'n_clear'];

var squares = ee.FeatureCollection('projects/rosy-ratio-511703-q3/assets/rq4_squares')
    .filter(ee.Filter.neq('square_id', 'Coastal_1'));
    var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

// Mask cloudy pixels, scale to reflectance, flag snow (SCL class 11)
function prep(img) {
  var clear = img.select('cs_cdf').gte(CS_THRESHOLD);
  var rgb = img.select(['B4', 'B3', 'B2']).multiply(0.0001).updateMask(clear);
  var snow = img.select('SCL').eq(11).updateMask(clear).rename('snow');
  return rgb.addBands(snow).addBands(clear.rename('clear'));
}

// One month: median composite at 10 m, indices at 10 m, then averaged to 1 km
function monthly(square, y, m) {
  var start = ee.Date.fromYMD(y, m, 1);
  var col = s2.filterBounds(square)
      .filterDate(start, start.advance(1, 'month'))
      .linkCollection(csPlus, ['cs_cdf'])
      .map(prep);
  var med = col.select(['B4', 'B3', 'B2']).median();
  var tot = med.select('B4').add(med.select('B3')).add(med.select('B2'));
  var img10 = ee.Image.cat([
    med.select('B4'), med.select('B3'), med.select('B2'),
    med.select('B3').divide(tot),
    med.select('B4').divide(tot),
    tot,
    col.select('snow').mean(),
    col.select('clear').sum()
  ]).rename(BANDS).setDefaultProjection({crs: CRS, scale: 10});
  var mm = (m < 10 ? '0' : '') + m;
  return img10
      .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 65535})
      .rename(BANDS.map(function(b) { return b + '_' + mm; }));
}

// Build the 7-month stack for the chosen square and year
var sq = ee.Feature(squares.filter(ee.Filter.eq('square_id', SQUARE_ID)).first());
var corner = sq.toDictionary(['xmin', 'ymax']).getInfo();
var geom = sq.geometry();
var stack = ee.Image.cat(MONTHS.map(function(m) { return monthly(geom, YEAR, m); })).toFloat();

print('Square:', SQUARE_ID, 'Year:', YEAR);
print('Corner used for the 1 km grid:', corner);
print('Bands in the export (56 expected):', stack.bandNames().size());

Export.image.toDrive({
  image: stack,
  description: 'rq4_s2_' + SQUARE_ID + '_' + YEAR,
  folder: 'rq4_s2',
  region: geom,
  crs: CRS,
  crsTransform: [1000, 0, corner.xmin, 0, -1000, corner.ymax],
  maxPixels: 1e9,
  fileFormat: 'GeoTIFF'
});