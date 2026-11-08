import test from 'node:test';import assert from 'node:assert/strict';import{gzipSync}from'node:zlib';
import {parseCues} from '../public/caption-format.js';import{findCaptions,captionText}from'../api/captions.mjs';
test('ASS timing, commas and line breaks survive conversion without style commands',()=>{
 const text='[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.50,0:00:05.00,Default,,0,0,0,,{\\i1}Hello, world!\\NNext line';assert.deepEqual(parseCues(text),[{start:2.5,end:5,text:'Hello, world!\nNext line'}]);
});
test('exact episode English captions are preferred to signs-only tracks and gzip is decoded',async()=>{
 const m={id:900010,title:'New show'};const transport=async url=>url.includes('/api/v1/feed')?Response.json([{anilist_id:m.id,episode_number:2,files:[{subtitles:[{link:'https://aniraws.org/tasks/1/subtitles/1',name:'English [Signs]',language:'ENG',format:'ASS'},{link:'https://aniraws.org/tasks/1/subtitles/2',name:'English',language:'ENG',format:'SRT'}]}]}]):new Response(gzipSync('1\n00:00:01,000 --> 00:00:02,000\nHello'),{headers:{'Content-Type':'application/gzip'}});
 const captions=await findCaptions(m,2,transport);assert.equal(captions[0].id,'ar-2');assert.equal(parseCues(await captionText(m,2,'ar-2',transport))[0].text,'Hello');
});
