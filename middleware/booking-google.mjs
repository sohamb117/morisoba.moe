export function configured(e){return !!(e.MIMORI_DB&&e.BOOKING_GOOGLE_CLIENT_ID&&e.BOOKING_GOOGLE_CLIENT_SECRET&&e.BOOKING_GOOGLE_REFRESH_TOKEN&&e.BOOKING_CALENDAR_ID);}
export async function googleAccessToken(e){
 const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:e.BOOKING_GOOGLE_CLIENT_ID,client_secret:e.BOOKING_GOOGLE_CLIENT_SECRET,refresh_token:e.BOOKING_GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(!auth.ok)throw Error('Calendar authentication failed');
 const {access_token}=await auth.json();return access_token;
}
export async function google(e,path,data,method='POST',headers={}){
 const access_token=await googleAccessToken(e);
 const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
 if(!r.ok&&!(method==='DELETE'&&[404,410].includes(r.status))){const err=Error('Calendar request failed');err.status=r.status;throw err;}
 return method==='DELETE'?{}:r.json();
}
