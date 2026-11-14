var squares = ee.FeatureCollection('projects/rosy-ratio-511703-q3/assets/rq4_squares');
var fireCentres = ee.FeatureCollection('projects/rosy-ratio-511703-q3/assets/bc_fire_centres');

// Remove Coastal_1 (decision recorded 15 Oct 2026, before any fire data was examined)
var finalSquares = squares.filter(ee.Filter.neq('square_id', 'Coastal_1'));

print('Squares kept:', finalSquares.size());
print('Square IDs:', finalSquares.aggregate_array('square_id'));

Export.table.toAsset({
  collection: finalSquares,
  description: 'rq4_step3_squares_final',
  assetId: 'projects/rosy-ratio-511703-q3/assets/rq4_squares_final'
});

Map.centerObject(fireCentres, 5);
Map.addLayer(ee.Image().paint(fireCentres, 0, 1), {palette: ['orange']}, 'Fire centres');
Map.addLayer(ee.Image().paint(finalSquares, 0, 3), {palette: ['red']}, 'Study squares (7)');