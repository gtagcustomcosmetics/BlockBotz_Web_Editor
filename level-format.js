window.BlockbotzLevelFormat = {
  version: 1,
  normalize: function(level){
    var data = level && typeof level === "object" ? level : {};
    return { objects: Array.isArray(data.objects) ? data.objects : [] };
  },
  stringify: function(level){ return JSON.stringify(this.normalize(level), null, 4); }
};
