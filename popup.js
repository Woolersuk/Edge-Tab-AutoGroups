
document.getElementById("current")
.addEventListener("click",()=>{
 chrome.runtime.sendMessage({action:"organiseCurrent"});
});

document.getElementById("all")
.addEventListener("click",()=>{
 chrome.runtime.sendMessage({action:"organiseAll"});
});

document.getElementById("rules")
.addEventListener("click",()=>{
 chrome.runtime.openOptionsPage();
});
