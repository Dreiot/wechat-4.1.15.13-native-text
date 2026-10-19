import fs from 'node:fs';
import path from 'node:path';
export const UPDATE_REPOSITORY='sourcepro5/WeChatAgent';
const releaseRoot='https://github.com/'+UPDATE_REPOSITORY+'/releases/';
const version=value=>{const match=/^(?:v)?(\d+)\.(\d+)\.(\d+)(-fix)?$/.exec(String(value??''));return match?{parts:match.slice(1,4).map(Number),fix:!!match[4],label:match.slice(1,4).join('.')+(match[4]??'')}:null;};
// The product's "-fix" label denotes a correction after the base release.
export function compareVersions(a,b){const left=version(a),right=version(b);if(!left||!right)throw Error('INVALID_VERSION');for(let i=0;i<3;i++)if(left.parts[i]!==right.parts[i])return left.parts[i]>right.parts[i]?1:-1;return Number(left.fix)-Number(right.fix);}
function metadata(root){for(const file of ['deployment.json','package.json'])try{const data=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));if(version(data.version))return data;}catch{}return {version:'0.3.6'};}
async function jsonResponse(response){let size=0,text='';if(!response.body)return response.json();for await(const chunk of response.body){size+=chunk.length;if(size>128*1024){await response.body.cancel?.().catch(()=>{});throw Error('UPDATE_RESPONSE_TOO_LARGE');}text+=Buffer.from(chunk).toString('utf8');}return JSON.parse(text);}
export function createUpdateChecker({root,fetchImpl=fetch,now=Date.now}={}) {
  const local=metadata(root);let cached,inflight,checkedAt=0;
  const base={currentVersion:local.version,repository:UPDATE_REPOSITORY,releaseUrl:releaseRoot+'latest'};
  async function request(url,signal){const response=await fetchImpl(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'WeChatAgent-UpdateCheck/'+local.version},signal});return {response,data:response.ok?await jsonResponse(response):null};}
  async function run(){
    const signal=AbortSignal.timeout(8000),stamp=new Date(now()).toISOString();
    try {
      const {response,data}=await request('https://api.github.com/repos/'+UPDATE_REPOSITORY+'/releases/latest',signal);
      if(response.status===404)return {...base,status:'not_published',checkedAt:stamp};
      if(!response.ok)throw Error('UPDATE_HTTP_'+response.status);
      if(data.draft||data.prerelease||!version(data.tag_name))throw Error('UPDATE_RELEASE_INVALID');
      const latestVersion=version(data.tag_name).label,tag=encodeURIComponent(data.tag_name);
      const file='WeChatAgent-Setup-'+latestVersion+'-x64.exe',downloadUrl=releaseRoot+'download/'+tag+'/'+file;
      const installer=(data.assets??[]).find(asset=>asset.name===file&&asset.state==='uploaded'&&asset.browser_download_url===downloadUrl);
      const comparison=compareVersions(latestVersion,local.version);
      if(!installer||comparison<0)return {...base,status:'up_to_date',checkedAt:stamp};
      let sameVersionBuild=false;
      if(comparison===0){
        const infoUrl=releaseRoot+'download/'+tag+'/VERIFICATION.json';
        const info=(data.assets??[]).find(asset=>asset.name==='VERIFICATION.json'&&asset.state==='uploaded'&&asset.browser_download_url===infoUrl);
        if(info&&local.buildId&&local.builtAt){const result=await request(infoUrl,signal),remote=result.data;
          sameVersionBuild=result.response.ok&&remote?.version===local.version&&/^[a-f0-9]{16}$/.test(remote.buildId??'')&&remote.buildId!==local.buildId&&Number.isFinite(Date.parse(remote.builtAt))&&Date.parse(remote.builtAt)>Date.parse(local.builtAt);
        }
      }
      return {...base,status:comparison>0||sameVersionBuild?'available':'up_to_date',latestVersion,sameVersionBuild,checkedAt:stamp,releaseUrl:releaseRoot+'tag/'+tag,...(comparison>0||sameVersionBuild?{downloadUrl}:{})};
    }catch{return {...base,status:'unavailable',checkedAt:stamp};}
  }
  return {check({force=false}={}){const at=now();if(inflight)return inflight;if(cached&&at-checkedAt<(force?15000:6*60*60*1000))return Promise.resolve(cached);inflight=run().then(result=>{cached=result;checkedAt=now();return result;}).finally(()=>{inflight=null;});return inflight;}};
}
