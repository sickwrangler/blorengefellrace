// REVIEW-ONLY Phase 3C.1A template. Do not deploy without Phase 3C.1B approval.
targetScope = 'resourceGroup'

@description('Short lowercase suffix chosen before deployment to make global names unique.')
@minLength(3)
@maxLength(7)
param nameSuffix string

@description('Production region.')
param location string = 'westeurope'

@description('Production event partition. Must not name development or test.')
param registrationEventPartition string = 'blorenge-2026-live'

@description('Public production origin.')
param registrationPublicBaseUrl string = 'https://www.blorengefellrace.cymru'

@description('Enable real entries for runners aged 16 or 17 only after external approval.')
param registrationUnder18Enabled bool = false

@secure()
@description('Operational alert receivers supplied manually as a receivers array of name/emailAddress objects.')
param alertContacts object

@description('Production tags. Never put personal information in tags.')
param tags object = {
  project: 'blorenge-fell-race'
  workload: 'registration'
  environment: 'production'
  dataClassification: 'private-runner-data'
  managedBy: 'bicep'
}

var storageAccountName = 'stblorengeregprod${nameSuffix}'
var communicationServiceName = 'acs-blorenge-registration-prod-${nameSuffix}'
var emailServiceName = 'ecs-blorenge-registration-prod-${nameSuffix}'
var schedulerFunctionName = 'func-blorenge-registration-scheduler-prod-${nameSuffix}'
var schedulerPlanName = 'asp-blorenge-registration-scheduler-prod-${nameSuffix}'
var logAnalyticsName = 'log-blorenge-registration-prod-${nameSuffix}'
var applicationInsightsName = 'appi-blorenge-registration-prod-${nameSuffix}'
var actionGroupName = 'ag-blorenge-registration-prod-${nameSuffix}'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = { parent: storage, name: 'default' }
resource registrationTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = { parent: tableService, name: 'RegistrationProduction' }
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 35 }
    containerDeleteRetentionPolicy: { enabled: true, days: 35 }
  }
}
resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'registration-backups', properties: { publicAccess: 'None' } }
resource schedulerPackageContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'scheduler-app-package', properties: { publicAccess: 'None' } }
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = { parent: storage, name: 'default' }

resource emailService 'Microsoft.Communication/emailServices@2023-03-31' = {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: { dataLocation: 'Europe' }
}
resource azureManagedEmailDomain 'Microsoft.Communication/emailServices/domains@2023-03-31' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: { domainManagement: 'AzureManaged', userEngagementTracking: 'Disabled' }
}
resource communicationService 'Microsoft.Communication/communicationServices@2023-03-31' = {
  name: communicationServiceName
  location: 'global'
  tags: tags
  properties: { dataLocation: 'Europe', linkedDomains: [azureManagedEmailDomain.id] }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: { retentionInDays: 30, sku: { name: 'PerGB2018' }, features: { enableLogAccessUsingOnlyResourcePermissions: true } }
}
resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logAnalytics.id, DisableLocalAuth: true }
}
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'BFRRegProd'
    enabled: true
    emailReceivers: [for (receiver, index) in alertContacts.receivers: { name: receiver.name, emailAddress: receiver.emailAddress, useCommonAlertSchema: true }]
  }
}

resource schedulerPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: schedulerPlanName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}
resource schedulerFunction 'Microsoft.Web/sites@2024-04-01' = {
  name: schedulerFunctionName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: schedulerPlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    functionAppConfig: {
      deployment: { storage: { type: 'blobContainer', value: '${storage.properties.primaryEndpoints.blob}${schedulerPackageContainer.name}', authentication: { type: 'SystemAssignedIdentity' } } }
      scaleAndConcurrency: { maximumInstanceCount: 10, instanceMemoryMB: 512 }
      runtime: { name: 'node', version: '22' }
    }
    siteConfig: {
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__blobServiceUri', value: storage.properties.primaryEndpoints.blob }
        { name: 'AzureWebJobsStorage__queueServiceUri', value: storage.properties.primaryEndpoints.queue }
        { name: 'AzureWebJobsStorage__tableServiceUri', value: storage.properties.primaryEndpoints.table }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: applicationInsights.properties.ConnectionString }
        { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD' }
        { name: 'REGISTRATION_ENVIRONMENT', value: 'production' }
        { name: 'REGISTRATION_STORAGE_ACCOUNT', value: storage.name }
        { name: 'REGISTRATION_TABLE', value: registrationTable.name }
        { name: 'REGISTRATION_EVENT_PARTITION', value: registrationEventPartition }
        { name: 'REGISTRATION_BACKUP_CONTAINER', value: backupContainer.name }
        { name: 'REGISTRATION_PUBLIC_BASE_URL', value: registrationPublicBaseUrl }
        { name: 'REGISTRATION_UNDER18_ENABLED', value: string(registrationUnder18Enabled) }
        { name: 'ACS_EMAIL_ENABLED', value: 'false' }
      ]
    }
  }
}

var blobDataOwnerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
var queueDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
var tableDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
var monitoringMetricsPublisherRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
var communicationOwnerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '09976791-48a7-449e-bb21-39d1a415f350')

resource schedulerBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(storage.id, schedulerFunction.id, blobDataOwnerRole), scope: storage, properties: { principalId: schedulerFunction.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobDataOwnerRole } }
resource schedulerQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(storage.id, schedulerFunction.id, queueDataContributorRole), scope: storage, properties: { principalId: schedulerFunction.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: queueDataContributorRole } }
resource schedulerTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(storage.id, schedulerFunction.id, tableDataContributorRole), scope: storage, properties: { principalId: schedulerFunction.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: tableDataContributorRole } }
resource schedulerEmailRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(communicationService.id, schedulerFunction.id, communicationOwnerRole), scope: communicationService, properties: { principalId: schedulerFunction.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: communicationOwnerRole } }
resource schedulerMonitoringRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(applicationInsights.id, schedulerFunction.id, monitoringMetricsPublisherRole), scope: applicationInsights, properties: { principalId: schedulerFunction.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: monitoringMetricsPublisherRole } }

var alertDefinitions = [
  { name: 'registration-critical-failures', description: 'Stripe, refund, capacity, waiting-list, backup or invalid-state failures', query: 'traces | where message has_any ("stripe_payment_reconciliation_failed", "refund_execution_failed", "capacity_invariant_failed", "waiting_list_progression_failed", "backup_failed", "production_state_invalid")' }
  { name: 'registration-persistent-5xx', description: 'Repeated production registration API 5xx responses', query: 'requests | where resultCode startswith "5" | summarize failures=count() by bin(timestamp, 5m) | where failures >= 3' }
  { name: 'registration-email-failures', description: 'Transactional email failures after retry', query: 'traces | where message == "registration_email_failed_after_retry"' }
  { name: 'registration-scheduler-heartbeat', description: 'No scheduler success for 75 minutes while registration is active', query: 'traces | where message == "Production registration scheduled work completed" | summarize lastSuccess=max(timestamp) | where lastSuccess < ago(75m)' }
]
resource alerts 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = [for alert in alertDefinitions: {
  name: '${alert.name}-${nameSuffix}'
  location: location
  tags: tags
  properties: {
    displayName: alert.description
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [applicationInsights.id]
    criteria: { allOf: [{ query: alert.query, timeAggregation: 'Count', operator: 'GreaterThan', threshold: 0, failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 } }] }
    actions: { actionGroups: [actionGroup.id] }
  }
}]

output proposedResourceNames object = {
  storageAccount: storage.name
  registrationTable: registrationTable.name
  backupContainer: backupContainer.name
  communicationService: communicationService.name
  emailService: emailService.name
  schedulerFunction: schedulerFunction.name
  schedulerPlan: schedulerPlan.name
  logAnalytics: logAnalytics.name
  applicationInsights: applicationInsights.name
  actionGroup: actionGroup.name
}
output schedulerPrincipalId string = schedulerFunction.identity.principalId
