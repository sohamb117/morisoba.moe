const query=`query { viewer { login url contributionsCollection { startedAt endedAt totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions contributionCalendar { totalContributions weeks { contributionDays { date weekday contributionCount contributionLevel } } } } } }`;
export async function gitActivity(token){
 const response=await fetch('https://api.github.com/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'morisoba-control'},body:JSON.stringify({query}),redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(response.status===401?'Reconnect GitHub':response.status===403?'GitHub access denied or rate limited':'GitHub activity unavailable');
 const result=await response.json();if(result.errors?.length||!result.data?.viewer?.contributionsCollection)throw Error('GitHub contribution access unavailable. Check your token’s read:user permission in Connection Manager.');
 const {login,url,contributionsCollection:c}=result.data.viewer;
 return {login,url,updatedAt:new Date().toISOString(),from:c.startedAt,to:c.endedAt,total:c.contributionCalendar.totalContributions,commits:c.totalCommitContributions,issues:c.totalIssueContributions,pulls:c.totalPullRequestContributions,reviews:c.totalPullRequestReviewContributions,weeks:c.contributionCalendar.weeks};
}
