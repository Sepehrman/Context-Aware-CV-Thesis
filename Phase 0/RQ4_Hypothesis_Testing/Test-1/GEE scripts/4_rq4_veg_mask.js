// ============================================================
// RQ4 Step 5a: vegetated fraction of every 1 km cell, per square.
// Source: ESA WorldCover v200 (2021, 10 m). Vegetated = tree cover (10),
// shrubland (20), grassland (30), herbaceous wetland (90), the same classes
// as the square selection rule. Output: rq4_veg_<square_id>.tif, one band
// 'veg_frac' (0 to 1), on the same 1 km grid as the Sentinel-2 exports.
// ============================================================
var CRS = 'EPSG:3005';
var DRIVE_FOLDER = 'rq4_s2';

// Seven study squares (Coastal_1 removed, decision recorded 15 Oct 2026)
var squares = ee.FeatureCollection('projects/rosy-ratio-511703-q3/assets/rq4_squares')
    .filter(ee.Filter.neq('square_id', 'Coastal_1'));

var veg10 = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map')
    .remap([10, 20, 30, 90], [1, 1, 1, 1], 0)
    .unmask(0)
    .rename('veg_frac')
    .toFloat();

// Mean of the 10 m vegetated flags inside each 1 km cell = vegetated fraction
var veg1k = veg10.reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 65535});

var info = squares.toList(20).map(function(f) {
  return ee.Feature(f).toDictionary(['square_id', 'xmin', 'ymin', 'xmax', 'ymax']);
}).getInfo();

info.forEach(function(sq) {
  var geom = ee.Geometry.Rectangle([sq.xmin, sq.ymin, sq.xmax, sq.ymax], CRS, false);
  Export.image.toDrive({
    image: veg1k,
    description: 'rq4_veg_' + sq.square_id,
    folder: DRIVE_FOLDER,
    region: geom,
    crs: CRS,
    crsTransform: [1000, 0, sq.xmin, 0, -1000, sq.ymax],
    maxPixels: 1e9,
    shardSize: 20,
    fileFormat: 'GeoTIFF'
  });
});

print('Vegetation mask exports created:', info.length);
