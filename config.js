window.TR = window.TR || {};

TR.config = Object.freeze({
  appName: 'מפת שימוש חוזר בטקסט',
  defaultJson: 'Kav_HaYashar.json',
  remoteSources: {
    endpoint: '',
    label: 'Google Drive',
    listAction: 'list',
    fileAction: 'file'
  },
  genizah: {
    itemsPath: 'Genizah_Data/geniza_items_with_image_links.json',
    domainsPath: 'Genizah_Data/friedberg_domains.json',
    templatesPath: 'Genizah_Data/image_url_templates.json'
  },
  sefariaBase: 'https://www.sefaria.org',
  maxBookMetadataConcurrency: 5,
  maxNetworkNodes: 24,
  maxScatterPoints: 2200,
  storageKeys: {
    preferences: 'textreuse_reader_preferences_v7_synopsis_reader',
    sefariaCache: 'textreuse_sefaria_cache_v4_hierarchy_address'
  },
  palette: [
    '#315a70', '#8a4d33', '#5c4e8a', '#3f6b4f', '#9a6a1f', '#8a3d61',
    '#526f86', '#765b37', '#4c7773', '#7b526f', '#6b6f39', '#4f5d8b',
    '#286f9b', '#a34a28', '#7352a3', '#2f8055', '#ad7d18', '#a14270',
    '#397d91', '#8d6334', '#34827b', '#8a537f', '#77823a', '#5269a1',
    '#b45a5a', '#5b8f46', '#876bb2', '#b07a45', '#4f8ea8', '#9a5f87'
  ]
});
