
async function getGroups(){
 const r=await chrome.storage.sync.get("groups");
 return r.groups||[];
}

function hostMatch(host,pattern){
 pattern=pattern.replace(/^\*\./,'');
 return host===pattern || host.endsWith('.'+pattern);
}

async function organiseWindow(windowId){

 const groups=await getGroups();
 const tabs=await chrome.tabs.query({windowId});

 const grouped={};

 for(const tab of tabs){

   if(!tab.url) continue;

   let host;
   try{ host=new URL(tab.url).hostname; }
   catch{ continue; }

   for(const g of groups){

      const matched=(g.patterns||[])
        .some(p=>hostMatch(host,p));

      if(matched){

         grouped[g.groupName] ??= {
            tabs:[],
            colour:g.colour
         };

         grouped[g.groupName].tabs.push(tab.id);
         break;
      }
   }
 }

 const existing=await chrome.tabGroups.query({windowId});

 for(const [name,data] of Object.entries(grouped)){

    let group=existing.find(g=>g.title===name);

    let groupId;

    if(group){

       groupId=group.id;

    } else {

       groupId=await chrome.tabs.group({
         tabIds:[data.tabs[0]]
       });

       await chrome.tabGroups.update(groupId,{
         title:name,
         color:data.colour||"blue"
       });
    }

    await chrome.tabs.group({
      tabIds:data.tabs,
      groupId
    });
 }
}

chrome.runtime.onMessage.addListener((msg,s,r)=>{

 if(msg.action==="organiseCurrent"){
   chrome.windows.getCurrent({},async w=>{
     await organiseWindow(w.id);
     r(true);
   });
   return true;
 }

 if(msg.action==="organiseAll"){
   chrome.windows.getAll({},async wins=>{
      for(const w of wins){
        await organiseWindow(w.id);
      }
      r(true);
   });
   return true;
 }
});
