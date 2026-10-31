"""Build the shared, credential-free iPhone Shortcut. Sign with Apple's shortcuts CLI.
Health action labels and data-flow follow iOS action metadata / captured exports;
installation, permissions and Health unit coercion still require device verification.
"""
from pathlib import Path
import plistlib
from uuid import uuid4
A=[]
def uid(): return str(uuid4()).upper()
def action(name, **params):
    key=uid(); A.append({'WFWorkflowActionIdentifier':'is.workflow.actions.'+name,'WFWorkflowActionParameters':{'UUID':key,**params}}); return key
def out(key,name='Output'): return {'Type':'ActionOutput','OutputUUID':key,'OutputName':name}
def var(name): return {'Type':'Variable','VariableName':name}
def ref(value): return {'Value':value,'WFSerializationType':'WFTextTokenAttachment'}
def text(*values):
    string=''; attachments={}
    for value in values:
        if isinstance(value,dict): attachments['{%d, 1}'%len(string)]=value; string+='\ufffc'
        else: string+=str(value)
    return {'Value':{'string':string,'attachmentsByRange':attachments},'WFSerializationType':'WFTextTokenString'}
def dictionary(items):
    return {'Value':{'WFDictionaryFieldValueItems':[{'WFItemType':0,'WFKey':text(k),'WFValue':text(v)} for k,v in items.items()]},'WFSerializationType':'WFDictionaryFieldValue'}
action('comment',WFCommentActionText='Life Portal Health: open from Life Portal to receive a one-use upload ticket. No account credentials or fixed server URL are stored here. Read-only Health access. Workout records are not exported by this version because a supported read action has not been verified.')
launch=action('detect.dictionary',WFInput=ref({'Type':'ExtensionInput'}))
config={k:action('getvalueforkey',WFInput=ref(out(launch,'Dictionary')),WFDictionaryKey=k,WFGetDictionaryValueType='Value') for k in ['token','from','to','uploadUrl']}
empty=action('list',WFItems=[])
action('setvariable',WFVariableName='Samples',WFInput=ref(out(empty,'List')))
for label,kind in [('Active Calories','activeEnergy'),('Steps','steps')]:
    action('comment',WFCommentActionText=f'Read {label} within the server-provided 72-hour window. Every row includes its source and exact start/end time. Life Portal merges overlapping sources; no daily midnight total is used.')
    filters=[{'Property':'Type','Operator':4,'Removable':False,'Bounded':True,'Values':{'Enumeration':{'Value':label,'WFSerializationType':'WFStringSubstitutableState'}}}]
    for prop,op,k in [('Start Date',2,'from'),('End Date',0,'to')]:
        filters.append({'Property':prop,'Operator':op,'Removable':True,'Bounded':True,'Values':{'Date':ref(out(config[k],'Dictionary Value'))}})
    found=action('filter.health.quantity',WFContentItemFilter={'Value':{'WFActionParameterFilterPrefix':1,'WFContentPredicateBoundedDate':False,'WFActionParameterFilterTemplates':filters},'WFSerializationType':'WFContentPredicateTableTemplate'},WFContentItemLimitEnabled=True,WFContentItemLimitNumber=1400,WFContentItemSortProperty='Start Date',WFContentItemSortOrder='Latest First')
    group=uid();action('repeat.each',WFInput=ref(out(found,'Health Samples')),GroupingIdentifier=group,WFControlFlowMode=0)
    details={p:action('properties.health.quantity',WFContentItemPropertyName=p,WFInput=ref(var('Repeat Item'))) for p in ['Start Date','End Date','Source','Value','Unit']}
    dates={p:action('format.date',WFDate=text(out(details[p],p)),WFDateFormatStyle='Custom',WFDateFormat='Custom',WFDateFormatString="yyyy-MM-dd'T'HH:mm:ssXXXXX") for p in ['Start Date','End Date']}
    fields={'id':text(out(dates['Start Date'],'Formatted Date'),'/',out(dates['End Date'],'Formatted Date')),'type':text(kind),'source':text(out(details['Source'],'Source')),'start':text(out(dates['Start Date'],'Formatted Date')),'end':text(out(dates['End Date'],'Formatted Date')),'value':text(out(details['Value'],'Value')),'unit':text(out(details['Unit'],'Unit'))}
    items={'Value':{'WFDictionaryFieldValueItems':[{'WFItemType':0,'WFKey':text(k),'WFValue':v} for k,v in fields.items()]},'WFSerializationType':'WFDictionaryFieldValue'}
    row=action('dictionary',WFItems=items)
    action('appendvariable',WFVariableName='Samples',WFInput=ref(out(row,'Dictionary')))
    action('repeat.each',GroupingIdentifier=group,WFControlFlowMode=2)
action('comment',WFCommentActionText='Serialize the sample dictionaries as JSON and upload using only the one-use Health ticket. The app marks sync successful only after server validation.')
combined=action('text.combine',WFTextCustomSeparator=',',WFTextSeparator='Custom',WFInput=ref(var('Samples')))
body=action('gettext',WFTextActionText=text('{"samples":[',out(combined,'Combined Text'),']}'))
action('downloadurl',WFURL=text(out(config['uploadUrl'],'Dictionary Value')),WFHTTPMethod='POST',WFHTTPBodyType='File',WFRequestVariable=ref(out(body,'Text')),WFHTTPHeaders=dictionary({'Content-Type':'application/json','x-health-ticket':out(config['token'],'Dictionary Value')}))
workflow={'WFWorkflowActions':A,'WFWorkflowName':'Life Portal Health','WFWorkflowClientVersion':'2600','WFWorkflowMinimumClientVersion':900,'WFWorkflowMinimumClientVersionString':'900','WFWorkflowIcon':{'WFWorkflowIconGlyphNumber':59472,'WFWorkflowIconStartColor':4282601983},'WFWorkflowInputContentItemClasses':['WFStringContentItem'],'WFWorkflowOutputContentItemClasses':[],'WFWorkflowTypes':[],'WFWorkflowImportQuestions':[],'WFWorkflowHasOutputFallback':False}
path=Path(__file__).with_name('Life Portal Health.plist');path.write_bytes(plistlib.dumps(workflow,sort_keys=False));print(path)
