import snapshot from '../data/catalogue-snapshot.json' with {type:'json'};
import titles from '../data/anidb-titles.json' with {type:'json'};
import {fetchJSON,ProviderError} from './provider.mjs';
const MAL=100000000,KITSU=200000000,ANIDB=300000000;
const clean=s=>String(s||'').replace(/<[^>]*>/g,'');
const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const indexed=titles.map(([id,title,aliases])=>({id:ANIDB+id,anidbId:id,title,alternateTitle:title,synonyms:aliases,format:null,episodes:null,totalEpisodes:null,status:'UNKNOWN',description:'',search:aliases.map(key)}));
export function offlineCatalog(query,id){
 if(id&&snapshot.titles.some(r=>r.id===id))return snapshot.titles.filter(r=>r.id===id);
 if(id)return indexed.filter(r=>r.id===id).map(({search,...r})=>r);
 if(!query)return snapshot.trending.map(id=>snapshot.titles.find(r=>r.id===id)).filter(Boolean);
 const q=key(query);if(!q)return [];
 const known=snapshot.titles.filter(r=>[r.title,r.alternateTitle,...(r.synonyms||[])].some(t=>key(t).includes(q)));
 const matches=indexed.map(r=>({r,score:Math.max(...r.search.map(t=>t===q?100:t.startsWith(q)?50:t.includes(q)?20:q.split(' ').every(w=>t.includes(w))?5:0))})).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.r.title.length-b.r.title.length).slice(0,24).map(({r:{search,...r}})=>r);
 return [...known,...matches.filter(r=>!known.some(k=>r.synonyms.some(t=>[k.title,k.alternateTitle,...(k.synonyms||[])].map(key).includes(key(t)))))].slice(0,24);
}
export async function kitsuCatalog(query,id,transport){
 const params=new URLSearchParams(query?{'filter[text]':query,'page[limit]':'20'}:{'filter[status]':'current','sort':'-userCount','page[limit]':'20'});
 const path=id?'/'+(id-KITSU):'?'+params;
 const j=await fetchJSON('https://kitsu.io/api/edge/anime'+path,{headers:{Accept:'application/vnd.api+json','User-Agent':'morisoba-ani/1.0'}},transport);
 const rows=id?[j.data]:j.data;if(!Array.isArray(rows))throw new ProviderError('Catalogue unavailable');
 return rows.filter(x=>x?.attributes).map(({id,attributes:a})=>({id:KITSU+Number(id),kitsuId:Number(id),title:a.titles?.en||a.canonicalTitle,alternateTitle:a.titles?.en_jp||a.canonicalTitle,synonyms:[...Object.values(a.titles||{}),...(a.abbreviatedTitles||[])],poster:a.posterImage?.large,format:(a.subtype||'TV').toUpperCase(),episodes:a.status==='finished'?a.episodeCount:null,totalEpisodes:a.episodeCount,status:a.status==='current'?'RELEASING':a.status==='finished'?'FINISHED':'NOT_YET_RELEASED',score:Number(a.averageRating)||null,year:Number(a.startDate?.slice(0,4))||null,description:clean(a.synopsis)}));
}
export async function malCatalog(query,id,transport){
 const path=id?'anime/'+(id-MAL)+'/full':query?'anime?q='+encodeURIComponent(query)+'&limit=24':'top/anime?filter=airing&limit=24';
 const j=await fetchJSON('https://api.jikan.moe/v4/'+path,{},transport);const rows=id?[j.data]:j.data;if(!Array.isArray(rows))throw new ProviderError('Catalogue unavailable');
 return rows.filter(Boolean).map(a=>({id:MAL+a.mal_id,malId:a.mal_id,title:a.title_english||a.title,alternateTitle:a.title,synonyms:[...(a.title_synonyms||[]),...(a.titles||[]).map(t=>t.title)],poster:a.images?.jpg?.large_image_url,format:(a.type||'TV').toUpperCase(),episodes:a.status==='Finished Airing'?a.episodes:null,totalEpisodes:a.episodes,status:a.airing?'RELEASING':a.status==='Not yet aired'?'NOT_YET_RELEASED':'FINISHED',score:a.score?Math.round(a.score*10):null,year:a.year||Number(a.aired?.from?.slice(0,4))||null,description:clean(a.synopsis)}));
}
export function catalogSource(id){return id>=ANIDB?'anidb':id>=KITSU?'kitsu':id>=MAL?'mal':'anilist';}
