// ============================================================
// RQ4 Step 5b: reference layers on the same 1 km grid as the Sentinel-2 composites.
// One GeoTIFF per square per dataset, all years and months in one file:
//   rq4_ndvi_<square_id>.tif   MODIS MOD13A3.061 monthly NDVI          bands ndvi_YYYY_MM
//   rq4_era5_<square_id>.tif   ERA5-Land monthly aggregates            bands t2m_YYYY_MM, precip_YYYY_MM, swvl1_YYYY_MM
//   rq4_firms_<square_id>.tif  FIRMS active fire detections per month  bands firms_YYYY_MM
// NDVI and ERA5-Land are the "what a tabular baseline already has" references for Step 7.
// FIRMS is used in Step 6 only (early-season exclusion and a sensitivity outcome).
// ============================================================

// ---------- SETTINGS (same period as the Sentinel-2 exports) ----------
var START_YEAR  = 2017;
var START_MONTH = 1;
var today = new Date();
var END_YEAR  = (today.getMonth() === 0) ? today.getFullYear() - 1 : today.getFullYear();
var END_MONTH = (today.getMonth() === 0) ? 12 : today.getMonth();   // last complete month

var CRS = 'EPSG:3005';
var DRIVE_FOLDER = 'rq4_s2';
var NDVI_QA_MAX = 1;   // MOD13A3 SummaryQA: 0 good, 1 marginal, 2 snow/ice, 3 cloudy. Keep 0 and 1.

// Seven study squares (Coastal_1 removed, decision recorded 15 Oct 2026)
var squares = ee.FeatureCollection('projects/rosy-ratio-511703-q3/assets/rq4_squares')
    .filter(ee.Filter.neq('square_id', 'Coastal_1'));

var mod13 = ee.ImageCollection('MODIS/061/MOD13A3');
var era5  = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR');
var firms = ee.ImageCollection('FIRMS');

var modisProj = mod13.first().select('NDVI').projection();
var firmsProj = firms.first().select('T21').projection();

// ---------- month list ----------
var monthsList = [];
for (var y = START_YEAR; y <= END_YEAR; y++) {
  var m0 = (y === START_YEAR) ? START_MONTH : 1;
  var m1 = (y === END_YEAR) ? END_MONTH : 12;
  for (var m = m0; m <= m1; m++) { monthsList.push([y, m]); }
}
function tag(y, m) { return y + '_' + (m < 10 ? '0' : '') + m; }
function monthCol(col, y, m) {
  var start = ee.Date.fromYMD(y, m, 1);
  return col.filterDate(start, start.advance(1, 'month'));
}
// Fully masked placeholder so that a month with no data gives "no data" instead of an error
function empty(names) {
  return ee.Image.constant(names.map(function() { return 0; })).rename(names)
      .toFloat().updateMask(ee.Image(0));
}

// ---------- MODIS NDVI: mean of the ~926 m MODIS pixels in each 1 km cell ----------
function ndviMonth(y, m) {
  var name = 'ndvi_' + tag(y, m);
  var col = monthCol(mod13, y, m).map(function(img) {
    return img.select('NDVI').multiply(0.0001)
        .updateMask(img.select('SummaryQA').lte(NDVI_QA_MAX))
        .rename(name).toFloat();
  }).merge(ee.ImageCollection([empty([name])]));
  return col.mean().setDefaultProjection(modisProj)
      .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024});
}

// ---------- ERA5-Land: value of the 0.1 degree grid cell containing each 1 km cell ----------
function era5Month(y, m) {
  var names = ['t2m_' + tag(y, m), 'precip_' + tag(y, m), 'swvl1_' + tag(y, m)];
  var col = monthCol(era5, y, m).map(function(img) {
    return img.select(['temperature_2m', 'total_precipitation_sum', 'volumetric_soil_water_layer_1'])
        .rename(names).toFloat();
  }).merge(ee.ImageCollection([empty(names)]));
  return col.mean();   // one image per month; exported with nearest-neighbour sampling
}

// ---------- FIRMS: detection pixel-days per 1 km cell ----------
// For each FIRMS pixel: number of days in the month with a detection (count of T21).
// For each 1 km cell: sum of those counts over the FIRMS pixels in the cell (area weighted).
// Greater than 0 means at least one detection in the cell during the month.
function firmsMonth(y, m) {
  var name = 'firms_' + tag(y, m);
  var days = monthCol(firms, y, m).select('T21').count().unmask(0).rename(name).toFloat();
  return days.setDefaultProjection(firmsProj)
      .reduceResolution({reducer: ee.Reducer.sum(), maxPixels: 1024});
}

// ---------- exports ----------
var info = squares.toList(20).map(function(f) {
  return ee.Feature(f).toDictionary(['square_id', 'xmin', 'ymin', 'xmax', 'ymax']);
}).getInfo();

var datasets = [
  {prefix: 'rq4_ndvi_',  fn: ndviMonth},
  {prefix: 'rq4_era5_',  fn: era5Month},
  {prefix: 'rq4_firms_', fn: firmsMonth}
];

var created = [];
info.forEach(function(sq) {
  var geom = ee.Geometry.Rectangle([sq.xmin, sq.ymin, sq.xmax, sq.ymax], CRS, false);
  datasets.forEach(function(ds) {
    var stack = ee.Image.cat(monthsList.map(function(ym) { return ds.fn(ym[0], ym[1]); })).toFloat();
    Export.image.toDrive({
      image: stack,
      description: ds.prefix + sq.square_id,
      folder: DRIVE_FOLDER,
      region: geom,
      crs: CRS,
      crsTransform: [1000, 0, sq.xmin, 0, -1000, sq.ymax],
      maxPixels: 1e9,
      shardSize: 20,
      fileFormat: 'GeoTIFF'
    });
    created.push(ds.prefix + sq.square_id);
  });
});

print('Period:', START_YEAR + '-' + START_MONTH + ' to ' + END_YEAR + '-' + END_MONTH,
      '(' + monthsList.length + ' months)');
print('Export tasks created:', created.length);
print(created);
