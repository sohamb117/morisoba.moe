export function appendChatText(parent,text){
 const source=String(text||''),links=/https?:\/\/[^\s<>]+/g;let start=0;
 for(const match of source.matchAll(links)){let url=match[0].replace(/[.,!?;:]+$/,'');while(url.endsWith(')')&&(url.match(/\(/g)||[]).length<(url.match(/\)/g)||[]).length)url=url.slice(0,-1);parent.append(document.createTextNode(source.slice(start,match.index)));const a=document.createElement('a');a.textContent=url;a.href=url;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);start=match.index+url.length;}parent.append(document.createTextNode(source.slice(start)));
}
export function discordImageUrl(media){
 try{const u=new URL(media.url);if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))return null;if(!media.contentType?.startsWith('image/')&&!/\.(?:png|jpe?g|gif|webp|avif)(?:$)/i.test(u.pathname))return null;return u.href;}catch{return null;}
}
export function imageThumbnail(media,url){
 const button=document.createElement('button'),thumb=document.createElement('img');button.type='button';button.className='chat-image-thumbnail';button.setAttribute('aria-label','View image: '+(media.name||'attachment'));thumb.src=url;thumb.alt=media.name||'Image attachment';thumb.loading='lazy';thumb.referrerPolicy='no-referrer';button.append(thumb);
 button.onclick=()=>{const dialog=document.createElement('dialog'),close=document.createElement('button'),img=document.createElement('img');dialog.className='chat-image-popup';close.type='button';close.className='chat-image-close';close.textContent='×';close.setAttribute('aria-label','Close image');close.onclick=()=>dialog.close();img.src=url;img.alt=thumb.alt;img.referrerPolicy='no-referrer';dialog.append(close,img);dialog.onclick=e=>{if(e.target===dialog)dialog.close();};dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();};return button;
}
