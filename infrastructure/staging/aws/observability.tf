resource "aws_sns_topic" "safety_alerts" {
  name              = "${var.name_prefix}-safety-alerts"
  display_name      = "ROS Staging Safety Alerts"
  kms_master_key_id = "alias/aws/sns"

  tags = {
    OnCallOwner = var.oncall_owner
  }
}

resource "aws_cloudwatch_metric_alarm" "api_no_healthy_targets" {
  alarm_name          = "${var.name_prefix}-api-no-healthy-targets"
  alarm_description   = "ROS staging API has no healthy ALB targets."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = aws_lb.internal.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }

  alarm_actions = [aws_sns_topic.safety_alerts.arn]
  ok_actions    = [aws_sns_topic.safety_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_target_5xx" {
  alarm_name          = "${var.name_prefix}-api-target-5xx"
  alarm_description   = "ROS staging API target 5xx responses exceeded the bounded threshold."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.internal.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }

  alarm_actions = [aws_sns_topic.safety_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_cpu" {
  alarm_name          = "${var.name_prefix}-api-cpu-high"
  alarm_description   = "ROS staging API sustained CPU utilization is high."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.staging.name
    ServiceName = aws_ecs_service.api.name
  }

  alarm_actions = [aws_sns_topic.safety_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu" {
  alarm_name          = "${var.name_prefix}-worker-cpu-high"
  alarm_description   = "ROS staging worker sustained CPU utilization is high."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.staging.name
    ServiceName = aws_ecs_service.worker.name
  }

  alarm_actions = [aws_sns_topic.safety_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "postgres_cpu" {
  alarm_name          = "${var.name_prefix}-postgres-cpu-high"
  alarm_description   = "ROS staging PostgreSQL sustained CPU utilization is high."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = [aws_sns_topic.safety_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "postgres_free_storage" {
  alarm_name          = "${var.name_prefix}-postgres-storage-low"
  alarm_description   = "ROS staging PostgreSQL free storage is below 20 GiB."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Minimum"
  threshold           = 21474836480
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }

  alarm_actions = [aws_sns_topic.safety_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${var.name_prefix}-redis-cpu-high"
  alarm_description   = "ROS staging Redis primary-node CPU utilization is high."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "breaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.redis.replication_group_id
  }

  alarm_actions = [aws_sns_topic.safety_alerts.arn]
}
