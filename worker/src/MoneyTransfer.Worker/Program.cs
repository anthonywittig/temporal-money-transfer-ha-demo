using MoneyTransfer.Core;
using MoneyTransfer.Worker;
using Temporalio.Extensions.Hosting;
using Temporalio.Runtime;

WorkerConfig config;
try
{
    config = WorkerConfig.FromEnvironment(Environment.GetEnvironmentVariable);
}
catch (WorkerConfigException e)
{
    Console.Error.WriteLine($"Configuration error: {e.Message}");
    return 2;
}

// SDK metrics plus app metrics (Workflow.MetricMeter / ActivityExecutionContext.MetricMeter)
// are exported by the Temporal runtime's Prometheus endpoint. The region is a global tag so
// per-region series can be told apart. Counters get a _total suffix.
var runtime = new TemporalRuntime(new TemporalRuntimeOptions
{
    Telemetry = new TelemetryOptions
    {
        Metrics = new MetricsOptions(new PrometheusOptions($"0.0.0.0:{config.MetricsPort}")
        {
            HasCounterTotalSuffix = true,
            UseSecondsForDuration = true,
        })
        {
            GlobalTags = new[] { new KeyValuePair<string, string>("region", config.Region) },
        },
    },
});

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{config.HttpPort}");
builder.Logging.AddFilter("Temporalio", config.TemporalLogLevel);

builder.Services
    .AddHostedTemporalWorker(config.Address, config.Namespace, config.TaskQueue)
    .AddWorkflow<MoneyTransferWorkflow>()
    .AddActivitiesInstance(new TransferActivities(config.Region))
    .ConfigureOptions(options =>
    {
        var client = options.ClientOptions!;
        client.Runtime = runtime;
        client.ApiKey = config.ApiKey;
        client.Tls = config.UseTls ? new() : null;
        // With a Regional Endpoint, the namespace must also be sent as a header so Temporal
        // Cloud can route the API-key request to the right Namespace.
        client.RpcMetadata = new Dictionary<string, string> { ["temporal-namespace"] = config.Namespace };
        options.Identity = $"{config.Region}/{Environment.MachineName}";
    });

AppMetrics.Preregister(runtime, config.Namespace, config.TaskQueue);

var app = builder.Build();
app.MapGet("/healthz", () => Results.Ok(new { status = "ok", region = config.Region }));

app.Logger.LogInformation(
    "Worker starting: region={Region} metricsPort={MetricsPort} address={Address} namespace={Namespace} taskQueue={TaskQueue}",
    config.Region, config.MetricsPort, config.Address, config.Namespace, config.TaskQueue);

await app.RunAsync();
return 0;
