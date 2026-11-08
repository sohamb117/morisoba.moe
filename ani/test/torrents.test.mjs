import test from 'node:test';import assert from 'node:assert/strict';
import {parseReleases,releaseEpisodes,chooseFile} from '../api/torrent-provider.mjs';
const media={id:1,title:'Cowboy Bebop',alternateTitle:'Cowboy Bebop',format:'TV',episodes:26};
test('matches individual airing episodes and versioned releases',()=>{assert.deepEqual(releaseEpisodes({title:'[SubsPlease] Overgeared - 02v2 (1080p) [ABC123].mkv'},{title:'Overgeared',episodes:2}),[2]);});
test('batch ranges do not invent episodes beyond the show',()=>{assert.deepEqual(releaseEpisodes({title:'[Erai-raws] Cowboy Bebop - 01 ~ 26 [1080p][BATCH]'},media),Array.from({length:26},(_,i)=>i+1));assert.deepEqual(releaseEpisodes({title:'Cowboy Bebop - 2026 [1080p]'},media),[]);});
test('matches underscore filenames and excludes bonus movies',()=>{const f=chooseFile([{id:1,path:'/Bonus/Interview 01.mp4'},{id:2,path:'/Cowboy_Bebop_-_01_Asteroid_Blues_[ABC].mp4'},{id:3,path:'/Cowboy.Bebop.S00E01.Movie.mkv'}],1,media);assert.equal(f.id,2);});
test('does not silently pick ambiguous episode files',()=>{assert.throws(()=>chooseFile([{id:1,path:'/S01E01.mkv'},{id:2,path:'/S02E01.mkv'}],1,media));});
test('matches catalog synonyms but rejects unrelated series',()=>{const row=(title,hash)=>`<item><title>${title}</title><nyaa:infoHash>${hash}</nyaa:infoHash><nyaa:seeders>5</nyaa:seeders></item>`;const rows=parseReleases(row('Overgeared - 01','a'.repeat(40))+row('Wrong Series - 01','b'.repeat(40)),{title:'Temppal',synonyms:['Overgeared']});assert.equal(rows.length,1);});
