// Highlights BC wildifre centres map
// var fireCentres = ee.FeatureCollection('projects/rosy-ratio-511703-q3/assets/bc_fire_centres');

// print('Number of fire centres:', fireCentres.size());
// print('Names:', fireCentres.aggregate_array('MFFRCNTRNM'));

// Map.centerObject(fireCentres, 5);
// Map.addLayer(fireCentres, {color: 'orange'}, 'Fire centres');

// ============================================================
// RQ4 Step 3c: place the study squares by the pre-registered rule.
// Do not change the SETTINGS after the pre-registration memo is dated.
// ============================================================

// ---------- SETTINGS ----------
var ASSET_FIRE_CENTRES = 'projects/rosy-ratio-511703-q3/assets/bc_fire_centres';
var ASSET_SQUARES_OUT  = 'projects/rosy-ratio-511703-q3/assets/rq4_squares';
var NAME_FIELD = 'MFFRCNTRNM';   // fire centre name
var ID_FIELD   = 'MFFRCNTRD';    // fire centre ID
var CRS = 'EPSG:3005';           // BC Albers
var SEED = 20261014;             // fixed random seed
var N_CANDIDATES = 100;          // random candidate positions per fire centre
var HALF = 50000;                // half the side of a square (100 km square)
var SNAP = 1000;                 // square centres snapped to a 1 km grid
var INSIDE_MIN = 0.999;          // share of the square inside its fire centre
var VEG_MIN = 0.60;              // share of the square that is vegetated
var STATS_SCALE = 100;           // resolution (m) of the two checks
var ALLOCATION = {
  'Prince George Fire Centre': 2,
  'Kamloops Fire Centre': 2,
  'Cariboo Fire Centre': 1,
  'Southeast Fire Centre': 1,
  'Northwest Fire Centre': 1,
  'Coastal Fire Centre': 1
};

// ---------- DATA ----------
var fireCentres = ee.FeatureCollection(ASSET_FIRE_CENTRES);
var fcImage = fireCentres.reduceToImage([ID_FIELD], ee.Reducer.first());

// ESA WorldCover v200: tree cover (10), shrubland (20), grassland (30),
// herbaceous wetland (90) count as vegetated. Everything else, including
// water and pixels with no data, counts as not vegetated.
var veg = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map')
    .remap([10, 20, 30, 90], [1, 1, 1, 1], 0)
    .unmask(0)
    .rename('veg');

// ---------- CANDIDATES ----------
function candidatesFor(name) {
  var centre = ee.Feature(fireCentres.filter(ee.Filter.eq(NAME_FIELD, name)).first());
  var id = ee.Number(centre.get(ID_FIELD));
  var inside = fcImage.eq(id).unmask(0).rename('inside');
  var stack = inside.addBands(veg);

  var pts = ee.FeatureCollection.randomPoints({
    region: centre.geometry(), points: N_CANDIDATES, seed: SEED, maxError: 10
  });
  var ptList = pts.toList(N_CANDIDATES);

  return ee.FeatureCollection(ee.List.sequence(0, N_CANDIDATES - 1).map(function(i) {
    var xy = ee.Feature(ptList.get(i)).geometry().transform(CRS, 1).coordinates();
    var cx = ee.Number(xy.get(0)).divide(SNAP).round().multiply(SNAP);
    var cy = ee.Number(xy.get(1)).divide(SNAP).round().multiply(SNAP);
    var square = ee.Geometry.Rectangle({
      coords: ee.List([cx.subtract(HALF), cy.subtract(HALF), cx.add(HALF), cy.add(HALF)]),
      proj: CRS, geodesic: false
    });
    var stats = stack.reduceRegion({
      reducer: ee.Reducer.mean(), geometry: square,
      crs: CRS, scale: STATS_SCALE, maxPixels: 1e9
    });
    var insideFrac = ee.Number(stats.get('inside'));
    var vegFrac = ee.Number(stats.get('veg'));
    return ee.Feature(square, {
      centre: name,
      draw_order: ee.Number(i).add(1),
      cx: cx, cy: cy,
      xmin: cx.subtract(HALF), ymin: cy.subtract(HALF),
      xmax: cx.add(HALF), ymax: cy.add(HALF),
      inside_frac: insideFrac,
      veg_frac: vegFrac,
      passes: insideFrac.gte(INSIDE_MIN).and(vegFrac.gte(VEG_MIN))
    });
  }));
}

// ---------- SELECTION ----------
// Take passing candidates in draw order. Accept one if fewer than n are
// accepted so far and it does not overlap an already accepted square.
function selectFrom(cands, n) {
  var passing = cands.filter(ee.Filter.eq('passes', 1)).sort('draw_order');
  var accepted = ee.List(passing.toList(N_CANDIDATES).iterate(function(f, acc) {
    f = ee.Feature(f);
    acc = ee.List(acc);
    var cx = ee.Number(f.get('cx'));
    var cy = ee.Number(f.get('cy'));
    var overlapCount = ee.Number(acc.map(function(a) {
      a = ee.Feature(a);
      return ee.Number(a.get('cx')).subtract(cx).abs().lt(2 * HALF)
        .and(ee.Number(a.get('cy')).subtract(cy).abs().lt(2 * HALF));
    }).add(0).reduce(ee.Reducer.sum()));
    var take = acc.size().lt(n).and(overlapCount.eq(0));
    return ee.Algorithms.If(take, acc.add(f.set('rank', acc.size().add(1))), acc);
  }, ee.List([])));
  return ee.FeatureCollection(accepted);
}

// ---------- RUN ----------
var allCands = ee.FeatureCollection([]);
var selected = ee.FeatureCollection([]);
Object.keys(ALLOCATION).forEach(function(name) {
  var c = candidatesFor(name);
  allCands = allCands.merge(c);
  selected = selected.merge(selectFrom(c, ALLOCATION[name]));
});
selected = selected.map(function(f) {
  var shortName = ee.String(f.get('centre')).replace(' Fire Centre', '').replace(' ', '_', 'g');
  return f.set('square_id', shortName.cat('_').cat(ee.Number(f.get('rank')).format('%d')));
});

// ---------- EXPORTS ----------
var cols = ['centre', 'draw_order', 'cx', 'cy', 'xmin', 'ymin', 'xmax', 'ymax',
            'inside_frac', 'veg_frac', 'passes'];

Export.table.toDrive({
  collection: allCands, description: 'rq4_step3_candidates',
  fileFormat: 'CSV', selectors: cols
});
Export.table.toDrive({
  collection: selected, description: 'rq4_step3_selected_squares',
  fileFormat: 'CSV', selectors: ['square_id', 'rank'].concat(cols)
});
Export.table.toAsset({
  collection: selected, description: 'rq4_step3_squares_asset',
  assetId: ASSET_SQUARES_OUT
});

Map.centerObject(fireCentres, 5);
Map.addLayer(ee.Image().paint(fireCentres, 0, 1), {palette: ['orange']}, 'Fire centre outlines');
print('Three export tasks are ready in the Tasks tab.');