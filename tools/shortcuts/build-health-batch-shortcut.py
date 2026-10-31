"""Generate the v2 read-only Health Shortcut; never overwrite the user's legacy artifact.
Requires Apple signing and an actual iPhone import/run check before publication.
"""
from pathlib import Path
from uuid import uuid4
import plistlib
A = []
def uid(): return str(uuid4()).upper()
def action(name, **params):
    key = uid()
    A.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.' + name, 'WFWorkflowActionParameters': {'UUID': key, **params}})
    return key
def out(key, name='Output'): return {'Type': 'ActionOutput', 'OutputUUID': key, 'OutputName': name}
def var(name): return {'Type': 'Variable', 'VariableName': name}
def ref(value): return {'Value': value, 'WFSerializationType': 'WFTextTokenAttachment'}
def text(*values):
    string = ''; attachments = {}
    for value in values:
        if isinstance(value, dict): attachments['{%d, 1}' % len(string)] = value; string += '\ufffc'
        else: string += str(value)
    return {'Value': {'string': string, 'attachmentsByRange': attachments}, 'WFSerializationType': 'WFTextTokenString'}
def dictionary(items):
    return {'Value': {'WFDictionaryFieldValueItems': [{'WFItemType': 0, 'WFKey': text(k), 'WFValue': text(v)} for k, v in items.items()]}, 'WFSerializationType': 'WFDictionaryFieldValue'}
def get(key, source): return action('getvalueforkey', WFInput=ref(source), WFDictionaryKey=key, WFGetDictionaryValueType='Value')
def condition(source, code, literal):
    group = uid()
    action('conditional', GroupingIdentifier=group, WFControlFlowMode=0, WFCondition=code, WFConditionalActionString=literal, WFInput={'Type': 'Variable', 'Variable': ref(source)})
    return group
def end_if(group): action('conditional', GroupingIdentifier=group, WFControlFlowMode=2)
action('comment', WFCommentActionText='Life Portal Health v2. Start from Life Portal. The supplied Health-only ticket expires after 15 minutes. No account password, permanent token or server URL is embedded. One run processes up to 12 windows; unfinished work stays queued on the server.')
launch = action('detect.dictionary', WFInput=ref({'Type': 'ExtensionInput'}))
config = {k: get(k, out(launch, 'Dictionary')) for k in ['token', 'batchUrl', 'to']}
outer = uid()
action('repeat.count', WFRepeatCount=12, GroupingIdentifier=outer, WFControlFlowMode=0)
action('comment', WFCommentActionText='Request the next pending interval. Never invent the next hour locally: the server may return a smaller window or resume an interrupted upload.')
next_request = action('downloadurl', WFURL=text(out(config['batchUrl'], 'Dictionary Value'), '/next'), WFHTTPMethod='POST', WFHTTPHeaders=dictionary({'x-health-ticket': out(config['token'], 'Dictionary Value')}))
state = get('state', out(next_request, 'Contents of URL'))
stop = condition(out(state, 'Dictionary Value'), 5, 'ready')
action('exit', WFResult=text('Health query processing stopped. Return to Life Portal for sync status and any remaining windows.'))
end_if(stop)
window = get('window', out(next_request, 'Contents of URL'))
w = {k: get(k, out(window, 'Dictionary Value')) for k in ['id', 'queryFrom', 'to', 'limitPerKind']}
empty = action('list', WFItems=[])
action('setvariable', WFVariableName='Samples', WFInput=ref(out(empty, 'List')))
finds = {}; counts = {}
for label, kind in [('Active Calories', 'activeEnergy'), ('Steps', 'steps')]:
    filters = [{'Property': 'Type', 'Operator': 4, 'Removable': False, 'Bounded': True, 'Values': {'Enumeration': {'Value': label, 'WFSerializationType': 'WFStringSubstitutableState'}}}]
    for prop, op, source in [('Start Date', 2, out(w['queryFrom'], 'Dictionary Value')), ('Start Date', 0, out(w['to'], 'Dictionary Value')), ('End Date', 0, out(config['to'], 'Dictionary Value'))]:
        filters.append({'Property': prop, 'Operator': op, 'Removable': True, 'Bounded': True, 'Values': {'Date': ref(source)}})
    finds[kind] = action('filter.health.quantity', WFContentItemFilter={'Value': {'WFActionParameterFilterPrefix': 1, 'WFContentPredicateBoundedDate': False, 'WFActionParameterFilterTemplates': filters}, 'WFSerializationType': 'WFContentPredicateTableTemplate'}, WFContentItemLimitEnabled=True, WFContentItemLimitNumber=text(out(w['limitPerKind'], 'Dictionary Value')), WFContentItemSortProperty='Start Date', WFContentItemSortOrder='Oldest First')
    counts[kind] = action('count', WFInput=ref(out(finds[kind], 'Health Samples')), WFCountType='Items')
    action('comment', WFCommentActionText=f'Serialize each {label} sample with source, absolute start/end time, displayed value and unit. Repeat Item refers to the inner Health Samples loop.')
    group = uid()
    action('repeat.each', WFInput=ref(out(finds[kind], 'Health Samples')), GroupingIdentifier=group, WFControlFlowMode=0)
    details = {p: action('properties.health.quantity', WFContentItemPropertyName=p, WFInput=ref(var('Repeat Item'))) for p in ['Start Date', 'End Date', 'Source', 'Value', 'Unit']}
    dates = {p: action('format.date', WFDate=text(out(details[p], p)), WFDateFormatStyle='Custom', WFDateFormat='Custom', WFDateFormatString="yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX") for p in ['Start Date', 'End Date']}
    fields = {'id': text(out(dates['Start Date'], 'Formatted Date'), '/', out(dates['End Date'], 'Formatted Date')), 'type': text(kind), 'source': text(out(details['Source'], 'Source')), 'start': text(out(dates['Start Date'], 'Formatted Date')), 'end': text(out(dates['End Date'], 'Formatted Date')), 'value': text(out(details['Value'], 'Value')), 'unit': text(out(details['Unit'], 'Unit'))}
    items = {'Value': {'WFDictionaryFieldValueItems': [{'WFItemType': 1 if k == 'value' else 0, 'WFKey': text(k), 'WFValue': v} for k, v in fields.items()]}, 'WFSerializationType': 'WFDictionaryFieldValue'}
    row = action('dictionary', WFItems=items)
    action('appendvariable', WFVariableName='Samples', WFInput=ref(out(row, 'Dictionary')))
    action('repeat.each', GroupingIdentifier=group, WFControlFlowMode=2)
action('comment', WFCommentActionText='Upload counts and the array for exactly this window. A capped result is split and re-fetched, not marked complete. The next iteration requests the authoritative server cursor. Failed writes or a lost response leave the pending window safe to retry.')
combined = action('text.combine', WFTextCustomSeparator=',', WFTextSeparator='Custom', WFInput=ref(var('Samples')))
body = action('gettext', WFTextActionText=text('{"windowId":"', out(w['id'], 'Dictionary Value'), '","activeCount":', out(counts['activeEnergy'], 'Count'), ',"stepCount":', out(counts['steps'], 'Count'), ',"samples":[', out(combined, 'Combined Text'), ']}'))
action('downloadurl', WFURL=text(out(config['batchUrl'], 'Dictionary Value'), '/upload'), WFHTTPMethod='POST', WFHTTPBodyType='File', WFRequestVariable=ref(out(body, 'Text')), WFHTTPHeaders=dictionary({'Content-Type': 'application/json', 'x-health-ticket': out(config['token'], 'Dictionary Value')}))
action('repeat.count', GroupingIdentifier=outer, WFControlFlowMode=2)
action('gettext', WFTextActionText='Health batch run finished. Remaining query windows, if any, resume on the next sync. Query completion does not prove complete device wear or permissions.')
workflow = {'WFWorkflowActions': A, 'WFWorkflowName': 'Life Portal Health', 'WFWorkflowClientVersion': '2600', 'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900', 'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59472, 'WFWorkflowIconStartColor': 4282601983}, 'WFWorkflowInputContentItemClasses': ['WFStringContentItem'], 'WFWorkflowOutputContentItemClasses': [], 'WFWorkflowTypes': [], 'WFWorkflowImportQuestions': [], 'WFWorkflowHasOutputFallback': False}
output = Path(__file__).with_name('batched'); output.mkdir(exist_ok=True)
path = output / 'Life Portal Health.plist'; path.write_bytes(plistlib.dumps(workflow, sort_keys=False))
# Mechanical checks: every data-flow reference exists; control-flow groups are balanced.
uuids = {a['WFWorkflowActionParameters']['UUID'] for a in A}
def check_refs(value):
    if isinstance(value, dict):
        if 'OutputUUID' in value: assert value['OutputUUID'] in uuids
        for v in value.values(): check_refs(v)
    elif isinstance(value, list):
        for v in value: check_refs(v)
check_refs(workflow)
stack = []
for a in A:
    p = a['WFWorkflowActionParameters']
    if 'WFControlFlowMode' not in p: continue
    if p['WFControlFlowMode'] == 0: stack.append(p['GroupingIdentifier'])
    elif p['WFControlFlowMode'] == 2: assert stack.pop() == p['GroupingIdentifier']
assert not stack
print(f'{path}: {len(A)} actions; references and control-flow groups checked. Device execution remains unverified.')
