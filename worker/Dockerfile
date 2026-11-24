# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY MoneyTransfer.sln ./
COPY src/MoneyTransfer.Core/MoneyTransfer.Core.csproj src/MoneyTransfer.Core/
COPY src/MoneyTransfer.Worker/MoneyTransfer.Worker.csproj src/MoneyTransfer.Worker/
RUN dotnet restore src/MoneyTransfer.Worker/MoneyTransfer.Worker.csproj
COPY src/ src/
RUN dotnet publish src/MoneyTransfer.Worker/MoneyTransfer.Worker.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app .
# The worker binds HTTP_PORT itself; clear the base image default to avoid an override warning.
ENV HTTP_PORT=8080 METRICS_PORT=9464 ASPNETCORE_HTTP_PORTS=
EXPOSE 8080 9464
USER $APP_UID
ENTRYPOINT ["dotnet", "MoneyTransfer.Worker.dll"]
