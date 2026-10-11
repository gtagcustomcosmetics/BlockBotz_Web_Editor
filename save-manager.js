window.BlockbotzSaveManager = {
  key: "blockbotz.savedGames.v2",
  read: function(){ try { var v=JSON.parse(localStorage.getItem(this.key)||"[]"); return Array.isArray(v)?v:[]; } catch(e){ return []; } },
  write: function(games){ try { localStorage.setItem(this.key, JSON.stringify(games)); return true; } catch(e){ console.warn(e); return false; } }
};
