import {mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function buildCalendarPages(output='calendar-dist',base=''){
 if(base&&!/^\/[A-Za-z0-9_.-]+$/.test(base))throw Error('Invalid Pages base path');
 const root=resolve(output);await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
 for(const dir of ['book','shared/fonts'])await cp(dir,root+'/'+dir,{recursive:true});
 for(const file of ['chrome.css','typography.css'])await cp('shared/'+file,root+'/shared/'+file);
 await mkdir(root+'/admin',{recursive:true});
 for(const [src,dest] of [['book/admin/index.html','admin/index.html'],['book/admin/login.html','admin/login.html'],['book/index.html','404.html']]){
 let html=await readFile(src,'utf8');
 html=html.replaceAll('href="/"','href="https://morisoba.moe/"').replace(/(href|src)="\/(book|shared)\//g,(_,attr,dir)=>attr+'="'+base+'/'+dir+'/');
 await writeFile(root+'/'+dest,html);
 }
 await writeFile(root+'/book/config.js',"globalThis.BOOKING_API_ORIGIN='https://morisoba.moe';\nglobalThis.BOOKING_BASE_PATH="+JSON.stringify(base)+";\n");
 await writeFile(root+'/index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url='+base+'/admin/"><title>Calendar</title></head><body><a href="'+base+'/admin/">Calendar admin</a></body></html>');
 await writeFile(root+'/.nojekyll','');
 console.log('Calendar frontend built in '+output+' (base path '+(base||'/')+').');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildCalendarPages(process.argv[2]||'calendar-dist',(process.env.PAGES_BASE_PATH||'').replace(/\/$/,''));
