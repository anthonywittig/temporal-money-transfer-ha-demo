using MoneyTransfer.Core;

namespace MoneyTransfer.Worker;

public class WorkerConfigException(string message) : Exception(message);

public record WorkerConfig(
    string Address,
    string Namespace,
    string? ApiKey,
    bool UseTls,
    string Region,
    string TaskQueue,
    int HttpPort,
    int MetricsPort,
    LogLevel TemporalLogLevel)
{
    /// <summary>
    /// Reads configuration from environment variables and fails fast, naming every missing
    /// variable. TEMPORAL_API_KEY is required unless TEMPORAL_INSECURE=true (local dev server).
    /// </summary>
    public static WorkerConfig FromEnvironment(Func<string, string?> env)
    {
        var missing = new List<string>();
        string Required(string name)
        {
            var v = env(name);
            if (string.IsNullOrWhiteSpace(v)) missing.Add(name);
            return v ?? "";
        }

        var insecure = string.Equals(env("TEMPORAL_INSECURE"), "true", StringComparison.OrdinalIgnoreCase);
        var address = Required("TEMPORAL_ADDRESS");
        var ns = Required("TEMPORAL_NAMESPACE");
        var region = Required("REGION");
        var apiKey = insecure ? env("TEMPORAL_API_KEY") : Required("TEMPORAL_API_KEY");

        if (missing.Count > 0)
        {
            throw new WorkerConfigException($"missing required environment variable(s): {string.Join(", ", missing)}");
        }

        var port = ParsePort(env, "HTTP_PORT", 8080);
        var metricsPort = ParsePort(env, "METRICS_PORT", 9464);

        var logText = env("TEMPORAL_LOG_LEVEL");
        var logLevel = LogLevel.Information;
        if (!string.IsNullOrWhiteSpace(logText) && !Enum.TryParse(logText, ignoreCase: true, out logLevel))
        {
            throw new WorkerConfigException($"TEMPORAL_LOG_LEVEL must be a LogLevel name, got '{logText}'");
        }

        var taskQueue = env("TASK_QUEUE");
        return new WorkerConfig(
            address,
            ns,
            string.IsNullOrWhiteSpace(apiKey) ? null : apiKey,
            UseTls: !insecure,
            region,
            string.IsNullOrWhiteSpace(taskQueue) ? Names.DefaultTaskQueue : taskQueue,
            port,
            metricsPort,
            logLevel);
    }

    private static int ParsePort(Func<string, string?> env, string name, int defaultValue)
    {
        var text = env(name);
        if (string.IsNullOrWhiteSpace(text)) return defaultValue;
        if (!int.TryParse(text, out var port) || port is < 1 or > 65535)
        {
            throw new WorkerConfigException($"{name} must be a port number, got '{text}'");
        }
        return port;
    }
}
