// Keep the window alive until its own services have stopped. Repeated quit
// events share one operation; a failed stop leaves the application recoverable.
function createShutdownController({confirm=async()=>true,stop,finish,onState=()=>{},onError=()=>{}}) {
  let pending=null,finished=false;
  return {
    get running(){return pending!==null;},
    get finished(){return finished;},
    request(){
      if(finished)return Promise.resolve(true);
      if(pending)return pending;
      pending=Promise.resolve().then(async()=>{
        onState('checking');
        if(!await confirm()){onState('idle');return false;}
        onState('stopping');await stop();finished=true;onState('stopped');finish();return true;
      }).catch(async error=>{onState('failed');await onError(error);return false;}).finally(()=>{pending=null;});
      return pending;
    },
  };
}
module.exports={createShutdownController};
