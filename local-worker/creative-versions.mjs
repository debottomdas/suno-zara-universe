// Version records are append-only. Only explicit approval changes the existing
// generated/uploaded pointers consumed by the established publishing pipeline.
export function outputName(slot) {if(!Number.isInteger(slot)||slot<0||slot>6)throw Error('Choose full video or Short 1–6.');return slot===0?'full':`short-${slot}`;}
export function syncDependencies(project,keys) {
 project.creative ||= {versions:[],approved:{},keys:{}};
 for(let slot=0;slot<=6;slot++){
  const name=outputName(slot),approved=project.creative.versions.find(v=>v.id===project.creative.approved[name]);
  if(approved&&approved.source==='generated'&&approved.dependencyKey!==keys[name]){
   delete project.creative.approved[name];
   if(slot===0)project.approvedFullVideoSource=null;else {project.approvedShortSources||={};delete project.approvedShortSources[String(slot)];}
  }
 }
 project.creative.keys={...keys};return project;
}
export function addCandidate(project,item,slot,dependencyKey,id) {
 outputName(slot);project.creative||={versions:[],approved:{},keys:{}};
 if(project.creative.versions.some(v=>v.id===id))throw Error('Candidate already exists.');
 const candidate={...item,id,slot,dependencyKey};project.creative.versions.push(candidate);return candidate;
}
export function approveCandidate(project,id){
 const c=project.creative,version=c?.versions.find(v=>v.id===id);if(!version)throw Error('Candidate not found.');const name=outputName(version.slot);
 if(version.source==='generated'&&c.keys[name]!==version.dependencyKey)throw Error('Inputs changed. Render and review a new candidate.');
 c.approved[name]=id;
 if(version.slot===0){project[version.source==='uploaded'?'uploadedFullVideo':'generatedFullVideo']=version;project.approvedFullVideoSource=version.source;project.approvedFullVideoAt=new Date().toISOString();}
 else {if(version.source==='uploaded'){project.uploadedShorts||={};project.uploadedShorts[String(version.slot)]=version;}else {project.generatedShorts=[...(project.generatedShorts||[]).filter(v=>v.slot!==version.slot),version];if(project.captionedShorts)delete project.captionedShorts[String(version.slot)];}project.approvedShortSources||={};project.approvedShortSources[String(version.slot)]=version.source;}
 return version;
}
