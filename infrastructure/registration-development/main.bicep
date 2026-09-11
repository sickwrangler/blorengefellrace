// APPROVED FOR THE ISOLATED SYNTHETIC DEVELOPMENT ENVIRONMENT ONLY.
targetScope = 'resourceGroup'

@description('Globally unique name for the isolated development Static Web App.')
param staticWebAppName string = 'swa-blorenge-registration-dev'

@description('Globally unique, lowercase name for synthetic registration storage.')
@minLength(3)
@maxLength(24)
param storageAccountName string = 'stblorengeregdev2026'

@description('Development-only Azure Communication Services resource name.')
param communicationServiceName string = 'acs-blorenge-registration-dev'

@description('Development-only Email Communication Service resource name.')
param emailServiceName string = 'ecs-blorenge-registration-dev'

@description('Development-only scheduled worker Function App name.')
param schedulerFunctionName string = 'func-blorenge-registration-scheduler-dev'

@description('Development-only Flex Consumption plan name.')
param schedulerPlanName string = 'asp-blorenge-registration-scheduler-dev'

@description('Development-only Log Analytics workspace name.')
param schedulerLogAnalyticsName string = 'log-blorenge-registration-scheduler-dev'

@description('Development-only Application Insights resource name.')
param schedulerApplicationInsightsName string = 'appi-blorenge-registration-scheduler-dev'

@secure()
@description('Comma-separated external development recipients. Supply at deployment; never commit a value.')
param registrationEmailSafeRecipients string

@secure()
@description('Azure-managed development sender address. Supply at deployment; never commit a value.')
param registrationEmailSender string

@description('Existing synthetic registration Table partition used by the stable development API.')
param registrationEventPartition string = 'blorenge-2026-test'

@description('A region supported by both Static Web Apps and Table Storage.')
param location string = 'westeurope'

@description('Development-only resource tags. Do not put personal data in tags.')
param tags object = {
  project: 'blorenge-fell-race'
  workload: 'registration'
  environment: 'development'
  dataClassification: 'synthetic-only'
  managedBy: 'bicep'
}

resource registrationSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Managed Static Web Apps Functions do not support managed identity.
    // Shared-key access is retained only to issue a revocable, table-scoped SAS.
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource schedulerDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'scheduler-app-package'
  properties: {
    publicAccess: 'None'
  }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource registrations 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'RegistrationDevelopment'
}

resource emailService 'Microsoft.Communication/emailServices@2023-03-31' = {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'Europe'
  }
}

resource managedEmailDomain 'Microsoft.Communication/emailServices/domains@2023-03-31' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2023-03-31' = {
  name: communicationServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'Europe'
    linkedDomains: [managedEmailDomain.id]
  }
}

resource schedulerLogAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: schedulerLogAnalyticsName
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource schedulerApplicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: schedulerApplicationInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: schedulerLogAnalytics.id
    DisableLocalAuth: true
  }
}

resource schedulerPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: schedulerPlanName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource schedulerFunction 'Microsoft.Web/sites@2024-04-01' = {
  name: schedulerFunctionName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: schedulerPlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${schedulerDeploymentContainer.name}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 512
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
    siteConfig: {
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: storage.properties.primaryEndpoints.blob
        }
        {
          name: 'AzureWebJobsStorage__queueServiceUri'
          value: storage.properties.primaryEndpoints.queue
        }
        {
          name: 'AzureWebJobsStorage__tableServiceUri'
          value: storage.properties.primaryEndpoints.table
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: schedulerApplicationInsights.properties.ConnectionString
        }
        {
          name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING'
          value: 'Authorization=AAD'
        }
        {
          name: 'REGISTRATION_ENVIRONMENT'
          value: 'development'
        }
        {
          name: 'REGISTRATION_STATE'
          value: 'test'
        }
        {
          name: 'REGISTRATION_STORAGE_ACCOUNT'
          value: storage.name
        }
        {
          name: 'REGISTRATION_TABLE'
          value: registrations.name
        }
        {
          name: 'REGISTRATION_EVENT_PARTITION'
          value: registrationEventPartition
        }
        {
          name: 'REGISTRATION_PUBLIC_BASE_URL'
          value: 'https://${registrationSite.properties.defaultHostname}'
        }
        {
          name: 'REGISTRATION_EMAIL_SAFE_RECIPIENTS'
          value: registrationEmailSafeRecipients
        }
        {
          name: 'REGISTRATION_EMAIL_SENDER'
          value: registrationEmailSender
        }
        {
          name: 'ACS_EMAIL_ENDPOINT'
          value: 'https://${communicationService.properties.hostName}'
        }
        {
          name: 'REGISTRATION_SCHEDULER_ALLOW_TEST_TIME'
          value: 'false'
        }
      ]
    }
  }
}

var storageBlobDataOwnerRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
var storageQueueDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
var storageTableDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
var monitoringMetricsPublisherRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
var communicationOwnerRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '09976791-48a7-449e-bb21-39d1a415f350')

resource schedulerBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, schedulerFunction.id, storageBlobDataOwnerRoleId)
  scope: storage
  properties: {
    principalId: schedulerFunction.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataOwnerRoleId
  }
}

resource schedulerQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, schedulerFunction.id, storageQueueDataContributorRoleId)
  scope: storage
  properties: {
    principalId: schedulerFunction.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleId
  }
}

resource schedulerTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, schedulerFunction.id, storageTableDataContributorRoleId)
  scope: storage
  properties: {
    principalId: schedulerFunction.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource schedulerCommunicationRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(communicationService.id, schedulerFunction.id, communicationOwnerRoleId)
  scope: communicationService
  properties: {
    principalId: schedulerFunction.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: communicationOwnerRoleId
  }
}

resource schedulerMonitoringRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(schedulerApplicationInsights.id, schedulerFunction.id, monitoringMetricsPublisherRoleId)
  scope: schedulerApplicationInsights
  properties: {
    principalId: schedulerFunction.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: monitoringMetricsPublisherRoleId
  }
}

output staticWebAppName string = registrationSite.name
output staticWebAppDefaultHostname string = registrationSite.properties.defaultHostname
output storageAccountName string = storage.name
output tableName string = registrations.name
output communicationServiceName string = communicationService.name
output emailServiceName string = emailService.name
output managedSenderDomainId string = managedEmailDomain.id
output schedulerFunctionName string = schedulerFunction.name
output schedulerFunctionPrincipalId string = schedulerFunction.identity.principalId
output schedulerApplicationInsightsName string = schedulerApplicationInsights.name
