const fields='id idMal title { english romaji native } coverImage { large } format episodes status synonyms nextAiringEpisode { episode airingAt } averageScore seasonYear description(asHtml:false)';
const normalize=m=>({id:m.id,malId:m.idMal,title:m.title.english||m.title.romaji||m.title.native,alternateTitle:m.title.romaji,poster:m.coverImage?.large,format:m.format,episodes:m.status==='NOT_YET_RELEASED'?0:m.nextAiringEpisode?Math.max(0,m.nextAiringEpisode.episode-1):m.episodes,totalEpisodes:m.episodes,status:m.status,synonyms:m.synonyms||[],score:m.averageScore,year:m.seasonYear,description:(m.description||'').replace(/<[^>]+>/g,'')});
export async function catalogue(query='',id=null){
 const key='ani.anilist.v1.'+(id?'id:'+id:'q:'+query.toLowerCase());let cached;try{cached=JSON.parse(localStorage.getItem(key));if(cached?.expires>Date.now())return cached.rows;}catch{}
 try{const gql=id?`query($id:Int!){Media(id:$id,type:ANIME){${fields}}}`:`query($search:String){Page(perPage:24){media(type:ANIME,search:$search,sort:${query?'SEARCH_MATCH':'TRENDING_DESC'}){${fields}}}}`;
  const response=await fetch('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query:gql,variables:id?{id}:{search:query||null}}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok||data.errors||!data.data)throw new Error('AniList is temporarily unavailable.');
  const rows=(id?[data.data.Media]:data.data.Page.media).filter(Boolean).map(normalize);try{localStorage.setItem(key,JSON.stringify({rows,expires:Date.now()+21600000}));}catch{}return rows;
 }catch(error){if(cached?.rows)return cached.rows;const response=await fetch(id?'/api/titles/'+id:'/api/search?q='+encodeURIComponent(query));const data=await response.json();const rows=id?[data]:data.results;if(response.ok&&Array.isArray(rows)&&rows.every(r=>r.id<100000000))return rows;throw error;}
}
